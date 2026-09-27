import type { MediaTrack } from '../domain/media';
import { formatDuration } from '../domain/media';
import { db } from './db';
import { api, streamCandidates } from './api';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { EqualizerGraph } from './equalizer';
import { useRoomStore } from '../room/client';
import { mixGains, transitionDuration } from './songTransitions';

type StoreState = ReturnType<typeof usePlaybackStore.getState>;
const PREPARE_LEAD_SECONDS = 90;

export class PlaybackEngine {
  private activeAudio = new Audio();
  get audio(): HTMLAudioElement { return this.activeAudio; }
  private unsubscribe?: () => void;
  private libraryUnsubscribe?: () => void;
  private currentKey = '';
  private loadRevision = 0;
  private audioContext?: AudioContext;
  private sourceNode?: GainNode;
  private deckNodes = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  private deckGains = new WeakMap<HTMLAudioElement, GainNode>();
  private roomUnsubscribe?: () => void;
  private prepared?: { audio: HTMLAudioElement; track: MediaTrack; index: number; candidates: string[]; sourceIndex: number; objectUrl?: string };
  private preparationKey = '';
  private preparationRevision = 0;
  private startingMix = false;
  private fading?: { audio: HTMLAudioElement; objectUrl?: string; start: number; duration: number; outgoingGain: number; incomingGain: number };
  private fadeTimer?: number;
  private compressor?: DynamicsCompressorNode;
  private equalizer?: EqualizerGraph;
  private graphMode = '';
  private sourceCandidates: string[] = [];
  private sourceIndex = 0;
  private objectUrl?: string;
  private handledTrackId?: string;
  private historyRecordId?: number;
  private lastListenPosition?: number;
  private pendingListenSeconds = 0;
  private suggestionsKey = '';
  private lastWarmKey = '';
  private destroyed = false;
  private eventsBound = false;

  constructor() {
    this.audio.preload = 'metadata';
    this.audio.crossOrigin = 'anonymous';
  }

  start(): () => void {
    if (this.unsubscribe) return () => this.stop();
    if (!this.eventsBound) { this.bindEvents(); this.eventsBound = true; }
    this.unsubscribe = usePlaybackStore.subscribe((state, previous) => this.applyState(state, previous));
    this.libraryUnsubscribe = useLibraryStore.subscribe((state, previous) => {
      if (state.playbackSettings !== previous.playbackSettings) {
        this.configureNormalizer(state.playbackSettings.normalizeVolume);
        this.cancelFade();
        void this.prepareNext();
      }
    });
    this.roomUnsubscribe = useRoomStore.subscribe(() => {
      if (useRoomStore.getState().status === 'connected') this.cancelFade();
      void this.prepareNext();
    });
    this.configureNormalizer(useLibraryStore.getState().playbackSettings.normalizeVolume);
    this.applyState(usePlaybackStore.getState(), usePlaybackStore.getState());
    this.configureMediaSession();
    return () => this.stop();
  }

  private bindEvents(audio = this.audio): void {
    const store = usePlaybackStore.getState;
    const on = (name: string, handler: () => void) => audio.addEventListener(name, () => { if (audio === this.audio) handler(); });
    on('loadedmetadata', () => {
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : store().currentTrack?.durationSeconds ?? 0;
      store().setDuration(duration);
      store().setStatus(this.audio.paused ? 'ready' : 'playing');
    });
    on('durationchange', () => {
      if (Number.isFinite(this.audio.duration)) store().setDuration(this.audio.duration);
    });
    on('timeupdate', () => {
      const position = this.audio.currentTime || 0;
      store().setPosition(position);
      const previous = this.lastListenPosition;
      if (!this.audio.paused && !this.audio.seeking && previous !== undefined && position >= previous) {
        this.pendingListenSeconds += (position - previous) / this.audio.playbackRate;
        if (this.pendingListenSeconds >= 10) this.flushListenTime();
      }
      this.lastListenPosition = position;
      void this.maybeTransition();
    });
    on('waiting', () => { if (!this.fading) this.cancelFade(); this.flushListenTime(); this.lastListenPosition = undefined; store().setStatus('loading'); });
    on('canplay', () => store().setStatus(this.audio.paused ? 'ready' : 'playing'));
    on('playing', () => {
      store().setStatus('playing');
      const track = store().currentTrack;
      if (track && this.handledTrackId !== track.id) {
        this.handledTrackId = track.id;
        this.lastListenPosition = this.audio.currentTime || 0;
        void useLibraryStore.getState().recordPlay(track).then((id) => {
          if (store().currentTrack?.id === track.id) {
            this.historyRecordId = id;
            this.flushListenTime();
          }
        });
      }
      this.updatePositionState();
    });
    on('pause', () => {
      this.flushListenTime();
      if (!this.audio.ended && store().status !== 'error') store().setStatus('paused');
    });
    on('ended', () => { this.cancelFade(); this.flushListenTime(); void this.handleEnded(); });
    on('error', () => { this.cancelFade(); void this.handleSourceError(); });
  }

  private flushListenTime(): void {
    if (!this.historyRecordId) return;
    const seconds = Math.floor(this.pendingListenSeconds);
    if (seconds < 1) return;
    this.pendingListenSeconds -= seconds;
    void useLibraryStore.getState().recordListenTime(this.historyRecordId, seconds);
  }

  private async applyState(state: StoreState, previous: StoreState): Promise<void> {
    if (this.destroyed) return;
    // HTMLAudioElement emits several clock ticks each second. A clock-only
    // update should not reconfigure audio, inspect the queue, or prepare a deck.
    if (state.position !== previous.position && state.currentTrack === previous.currentTrack
      && state.queue === previous.queue && state.sourceRevision === previous.sourceRevision
      && state.isPlaying === previous.isPlaying && state.status === previous.status
      && state.duration === previous.duration && state.volume === previous.volume
      && state.muted === previous.muted && state.playbackRate === previous.playbackRate
      && state.shuffle === previous.shuffle && state.repeat === previous.repeat
      && state.currentIndex === previous.currentIndex) {
      if (Math.abs((this.audio.currentTime || 0) - state.position) > 1.25 && Number.isFinite(state.position)) {
        this.cancelFade();
        try { this.audio.currentTime = state.position; this.lastListenPosition = state.position; } catch { /* metadata not ready */ }
      }
      if (state.isPlaying && (state.duration - state.position) / state.playbackRate <= PREPARE_LEAD_SECONDS) void this.prepareNext();
      this.updatePositionState();
      return;
    }
    this.setDeckVolume(this.audio, state.volume * (this.fading?.incomingGain ?? 1));
    this.audio.muted = state.muted;
    this.audio.playbackRate = state.playbackRate;
    if (this.fading) { this.setDeckVolume(this.fading.audio, state.volume * this.fading.outgoingGain); this.fading.audio.muted = state.muted; }
    if (!state.isPlaying) this.cancelFade();
    const key = state.currentTrack ? `${state.currentTrack.id}:${state.sourceRevision}` : '';
    if (key !== this.currentKey) {
      this.cancelFade();
      this.clearPrepared();
      this.flushListenTime();
      this.currentKey = key;
      this.handledTrackId = undefined;
      this.historyRecordId = undefined;
      this.lastListenPosition = undefined;
      this.pendingListenSeconds = 0;
      if (!state.currentTrack) {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        return;
      }
      const revision = ++this.loadRevision;
      await this.loadTrack(state.currentTrack, revision);
      if (key !== this.currentKey) return;
    }
    const liveState = usePlaybackStore.getState();
    this.warmUpcoming(liveState);
    void this.prepareNext();
    if (liveState.autoplayEligible && liveState.queue.length === 1 && liveState.currentTrack?.source !== 'local') {
      void this.seedSuggestions(liveState.currentTrack!, `${liveState.currentTrack!.id}:${liveState.sourceRevision}`);
    }
    if (Math.abs((this.audio.currentTime || 0) - liveState.position) > 1.25 && Number.isFinite(liveState.position)) {
      this.cancelFade();
      try { this.audio.currentTime = liveState.position; this.lastListenPosition = liveState.position; } catch { /* metadata may not be ready yet */ }
    }
    if (liveState.isPlaying && this.audio.paused && this.audio.src) {
      try {
        if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
        await this.audio.play();
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          usePlaybackStore.setState({ isPlaying: false, status: 'paused', error: 'Press play to start audio in this browser.' });
        }
      }
    } else if (!liveState.isPlaying && !this.audio.paused) {
      this.audio.pause();
    }
    if (liveState.currentTrack !== previous.currentTrack) this.updateMediaSession(liveState.currentTrack);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = liveState.isPlaying ? 'playing' : 'paused';
    if (liveState.position !== previous.position || liveState.duration !== previous.duration || liveState.playbackRate !== previous.playbackRate) this.updatePositionState();
  }

  private warmUpcoming(state: StoreState): void {
    if (!state.isPlaying || !state.currentTrack || state.shuffle || state.repeat === 'one') return;
    const next = state.queue[state.currentIndex + 1] ?? (state.repeat === 'all' ? state.queue[0] : undefined);
    if (!next || next.source !== 'remote') return;
    const quality = useLibraryStore.getState().playbackSettings.preferredQuality;
    const key = `${state.currentTrack.id}:${state.currentIndex}:${next.id}:${quality}`;
    if (key === this.lastWarmKey) return;
    this.lastWarmKey = key;
    void api.warmStream(next, quality).catch(() => undefined);
  }

  private async loadTrack(track: MediaTrack, revision: number): Promise<void> {
    usePlaybackStore.getState().setStatus('loading');
    this.audio.pause();
    let candidates: string[];
    let nextObjectUrl: string | undefined;
    if (track.source === 'local') {
      const record = await db.files.get(track.fileId || track.id);
      if (revision !== this.loadRevision) return;
      if (!record?.blob) {
        usePlaybackStore.setState({ isPlaying: false, status: 'error', error: 'This local file is no longer available. Import it again.' });
        return;
      }
      nextObjectUrl = URL.createObjectURL(record.blob);
      candidates = [nextObjectUrl];
    } else {
      candidates = streamCandidates(track, useLibraryStore.getState().playbackSettings.preferredQuality);
    }
    if (revision !== this.loadRevision) { if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl); return; }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = nextObjectUrl;
    this.sourceCandidates = candidates;
    this.sourceIndex = 0;
    this.audio.src = candidates[0] ?? '';
    this.audio.load();
    if (usePlaybackStore.getState().isPlaying) {
      try {
        if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
        if (revision === this.loadRevision) await this.audio.play();
      } catch { /* error and autoplay events provide actionable state */ }
    }
    if (revision === this.loadRevision) this.updateMediaSession(track);
  }

  private setDeckVolume(audio: HTMLAudioElement, volume: number): void {
    const gain = this.deckGains.get(audio);
    if (gain) {
      // Some mobile browsers only expose device volume on media elements.
      // Web Audio provides a reliable independent fader for each song.
      audio.volume = 1;
      gain.gain.value = volume;
    } else audio.volume = volume;
  }

  private connectDeck(audio: HTMLAudioElement): void {
    if (!this.audioContext || !this.sourceNode) return;
    let node = this.deckNodes.get(audio);
    if (!node) {
      try {
        node = this.audioContext.createMediaElementSource(audio);
        this.deckNodes.set(audio, node);
        const gain = this.audioContext.createGain();
        gain.gain.value = audio.volume;
        node.connect(gain);
        gain.connect(this.sourceNode);
        this.deckGains.set(audio, gain);
        audio.volume = 1;
      } catch {
        // If creation failed after the element was routed into Web Audio,
        // reconnect it directly so playback is still audible.
        try { node?.connect(this.sourceNode); } catch { /* native audio can still play */ }
      }
    }
  }

  private releaseDeck(audio: HTMLAudioElement, objectUrl?: string): void {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    this.deckNodes.get(audio)?.disconnect();
    this.deckGains.get(audio)?.disconnect();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }

  private clearPrepared(): void {
    this.preparationRevision += 1;
    this.preparationKey = '';
    if (this.prepared) this.releaseDeck(this.prepared.audio, this.prepared.objectUrl);
    this.prepared = undefined;
  }

  private async prepareNext(): Promise<void> {
    if (this.fading) return;
    const state = usePlaybackStore.getState();
    const settings = useLibraryStore.getState().playbackSettings;
    if (!state.currentTrack || settings.transitionMode === 'off' || state.repeat === 'one' || useRoomStore.getState().status === 'connected' || state.queue.length < 2) {
      if (this.preparationKey || this.prepared) this.clearPrepared();
      return;
    }
    if (!this.prepared && (!state.isPlaying || !state.duration || (state.duration - state.position) / state.playbackRate > PREPARE_LEAD_SECONDS)) return;
    const nextKey = state.shuffle ? state.queue.length : state.queue[state.currentIndex + 1]?.id ?? (state.repeat === 'all' ? state.queue[0]?.id : 'end');
    const key = `${this.currentKey}:${state.currentIndex}:${nextKey}:${state.shuffle}:${state.repeat}:${settings.transitionMode}:${settings.preferredQuality}:${Math.round(state.duration)}`;
    if (key === this.preparationKey) return;
    this.clearPrepared();
    this.preparationKey = key;
    const revision = this.preparationRevision;
    let index = state.currentIndex + 1;
    if (state.shuffle) {
      const choices = state.queue.map((_, i) => i).filter(i => i !== state.currentIndex);
      index = choices[Math.floor(Math.random() * choices.length)];
    } else if (index >= state.queue.length && state.repeat === 'all') index = 0;
    const track = state.queue[index];
    if (!track || !transitionDuration(settings, state.currentTrack, track, this.audio.duration || state.duration)) return;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    audio.volume = 0;
    audio.muted = state.muted;
    audio.playbackRate = state.playbackRate;
    let objectUrl: string | undefined;
    let candidates: string[];
    if (track.source === 'local') {
      const record = await db.files.get(track.fileId || track.id);
      if (revision !== this.preparationRevision || !record?.blob) return;
      objectUrl = URL.createObjectURL(record.blob);
      candidates = [objectUrl];
    } else candidates = streamCandidates(track, settings.preferredQuality);
    if (revision !== this.preparationRevision) { if (objectUrl) URL.revokeObjectURL(objectUrl); return; }
    const prepared = { audio, track, index, candidates, sourceIndex: 0, objectUrl };
    this.prepared = prepared;
    this.bindEvents(audio);
    this.connectDeck(audio);
    audio.addEventListener('canplay', () => {
      if (this.prepared === prepared) void this.maybeTransition();
    });
    audio.addEventListener('error', () => {
      if (this.prepared !== prepared) return;
      if (prepared.sourceIndex + 1 < candidates.length) {
        audio.src = candidates[++prepared.sourceIndex];
        audio.load();
      } else { this.prepared = undefined; this.releaseDeck(audio, objectUrl); }
    });
    audio.src = candidates[0] || '';
    audio.load();
  }

  private async maybeTransition(): Promise<void> {
    const state = usePlaybackStore.getState();
    const prepared = this.prepared;
    if (!prepared || this.startingMix || this.fading || !state.isPlaying || this.audio.paused || this.audio.seeking || state.repeat === 'one' || useRoomStore.getState().status === 'connected' || !state.currentTrack) return;
    const seconds = transitionDuration(useLibraryStore.getState().playbackSettings, state.currentTrack, prepared.track, this.audio.duration);
    const remaining = (this.audio.duration - this.audio.currentTime) / this.audio.playbackRate;
    if (!seconds || remaining > seconds || remaining < .2 || prepared.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    const outgoing = this.audio;
    const key = this.currentKey;
    this.startingMix = true;
    try {
      prepared.audio.playbackRate = state.playbackRate;
      if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
      await prepared.audio.play();
      if (this.prepared !== prepared || key !== this.currentKey || !usePlaybackStore.getState().isPlaying || useRoomStore.getState().status === 'connected') {
        prepared.audio.pause();
        return;
      }
      this.flushListenTime();
      const outgoingUrl = this.objectUrl;
      this.prepared = undefined;
      this.preparationKey = '';
      this.preparationRevision += 1;
      this.activeAudio = prepared.audio;
      this.objectUrl = prepared.objectUrl;
      this.sourceCandidates = prepared.candidates;
      this.sourceIndex = prepared.sourceIndex;
      this.handledTrackId = undefined;
      this.historyRecordId = undefined;
      this.pendingListenSeconds = 0;
      this.lastListenPosition = undefined;
      this.fading = { audio: outgoing, objectUrl: outgoingUrl, start: this.audio.currentTime, duration: Math.min(seconds, remaining) * state.playbackRate, outgoingGain: 1, incomingGain: 0 };
      const latest = usePlaybackStore.getState();
      this.currentKey = `${prepared.track.id}:${latest.sourceRevision + 1}`;
      latest.playTracks(latest.queue, prepared.index, latest.contextLabel);
      latest.setDuration(this.audio.duration);
      latest.setPosition(this.audio.currentTime);
      this.audio.dispatchEvent(new Event('playing'));
      this.fadeTimer = window.setInterval(() => {
        const fade = this.fading;
        if (!fade) return;
        const progress = (this.audio.currentTime - fade.start) / fade.duration;
        const [outgoingGain, incomingGain] = mixGains(progress);
        fade.outgoingGain = outgoingGain;
        fade.incomingGain = incomingGain;
        const playback = usePlaybackStore.getState();
        this.setDeckVolume(fade.audio, playback.volume * outgoingGain);
        this.setDeckVolume(this.audio, playback.volume * incomingGain);
        if (progress >= 1 || fade.audio.ended) this.cancelFade();
      }, 50);
    } catch {
      if (this.prepared === prepared) { this.prepared = undefined; this.releaseDeck(prepared.audio, prepared.objectUrl); }
      // An unready or blocked next stream falls back to ordinary playback.
    } finally { this.startingMix = false; }
  }

  private cancelFade(): void {
    window.clearInterval(this.fadeTimer);
    this.fadeTimer = undefined;
    const fade = this.fading;
    this.fading = undefined;
    if (fade) this.releaseDeck(fade.audio, fade.objectUrl);
    this.setDeckVolume(this.audio, usePlaybackStore.getState().volume);
  }

  private async handleEnded(): Promise<void> {
    const playback = usePlaybackStore.getState();
    const atQueueEnd = playback.currentIndex >= playback.queue.length - 1;
    const autoplay = useLibraryStore.getState().playbackSettings.autoplay;
    if (!atQueueEnd || playback.repeat !== 'off' || !autoplay || !playback.autoplayEligible || !playback.currentTrack || playback.currentTrack.source === 'local') {
      playback.next(true);
      return;
    }
    const endedTrack = playback.currentTrack;
    const requestRevision = playback.sourceRevision;
    playback.setStatus('loading');
    try {
      const related = (await api.related(endedTrack.id)).filter((track) => !playback.queue.some((queued) => queued.id === track.id));
      const latest = usePlaybackStore.getState();
      if (latest.currentTrack?.id !== endedTrack.id || latest.sourceRevision !== requestRevision) return;
      if (related.length) latest.playTracks([endedTrack, ...related], 1, 'Aurora autoplay');
      else latest.next(true);
    } catch {
      const latest = usePlaybackStore.getState();
      if (latest.currentTrack?.id === endedTrack.id && latest.sourceRevision === requestRevision) latest.next(true);
    }
  }

  private async seedSuggestions(track: MediaTrack, key: string): Promise<void> {
    if (this.suggestionsKey === key || !useLibraryStore.getState().playbackSettings.autoplay) return;
    this.suggestionsKey = key;
    try {
      const related = await api.related(track.id);
      const latest = usePlaybackStore.getState();
      if (latest.currentTrack?.id !== track.id || latest.queue.length !== 1 || !latest.autoplayEligible) return;
      const unique = related.filter((item, index) => item.id !== track.id && related.findIndex((candidate) => candidate.id === item.id) === index)
        .map((item) => ({ ...item, recommended: true }));
      unique.slice(0, 20).forEach((item) => usePlaybackStore.getState().addToQueue(item));
    } catch {
      // Keep the one-track queue playable when recommendations are unavailable.
    }
  }

  private async handleSourceError(): Promise<void> {
    if (this.sourceIndex + 1 < this.sourceCandidates.length) {
      this.sourceIndex += 1;
      this.audio.src = this.sourceCandidates[this.sourceIndex];
      this.audio.load();
      if (usePlaybackStore.getState().isPlaying) {
        try { await this.audio.play(); } catch { /* surfaced by next media error */ }
      }
      return;
    }
    const mediaError = this.audio.error;
    const message = mediaError?.code === MediaError.MEDIA_ERR_NETWORK
      ? 'The audio stream was interrupted. Check the connection and retry.'
      : mediaError?.code === MediaError.MEDIA_ERR_DECODE
        ? 'This audio format is not supported by the browser.'
        : 'This track could not be played. Retry or choose another song.';
    usePlaybackStore.setState({ isPlaying: false, status: 'error', error: message });
  }

  private configureNormalizer(enabled: boolean): void {
    if (!('AudioContext' in window)) return;
    try {
      this.audioContext ??= new AudioContext();
      this.sourceNode ??= this.audioContext.createGain();
      this.connectDeck(this.audio);
      this.compressor ??= this.audioContext.createDynamicsCompressor();
      this.compressor.threshold.value = -20;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 3;
      this.compressor.attack.value = .02;
      this.compressor.release.value = .24;
      const settings = useLibraryStore.getState().playbackSettings;
      this.equalizer ??= new EqualizerGraph(this.audioContext);
      this.equalizer.update(settings.equalizerGains);
      const mode = `${enabled}:${settings.equalizerEnabled}`;
      if (this.graphMode === mode) return;
      this.sourceNode.disconnect();
      this.compressor.disconnect();
      let output: AudioNode = settings.equalizerEnabled ? this.equalizer.connect(this.sourceNode) : this.sourceNode;
      if (enabled) { output.connect(this.compressor); output = this.compressor; }
      output.connect(this.audioContext.destination);
      this.graphMode = mode;
    } catch {
      try { this.sourceNode?.disconnect(); this.sourceNode?.connect(this.audioContext!.destination); this.graphMode = ''; } catch { /* Keep the original media element available. */ }
      // Some browsers disallow media-element graph creation; native playback remains available.
    }
  }

  private configureMediaSession(): void {
    if (!('mediaSession' in navigator)) return;
    const session = navigator.mediaSession;
    session.setActionHandler('play', () => usePlaybackStore.getState().play());
    session.setActionHandler('pause', () => usePlaybackStore.getState().pause());
    session.setActionHandler('previoustrack', () => usePlaybackStore.getState().previous());
    session.setActionHandler('nexttrack', () => usePlaybackStore.getState().next());
    session.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') usePlaybackStore.getState().seek(details.seekTime);
    });
    session.setActionHandler('seekbackward', (details) => usePlaybackStore.getState().seek(Math.max(0, this.audio.currentTime - (details.seekOffset || 10))));
    session.setActionHandler('seekforward', (details) => usePlaybackStore.getState().seek(Math.min(this.audio.duration || Infinity, this.audio.currentTime + (details.seekOffset || 10))));
  }

  private updateMediaSession(track: MediaTrack | null): void {
    if (!('mediaSession' in navigator)) return;
    if (!track) { navigator.mediaSession.metadata = null; return; }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || 'Aurora Music',
      artwork: track.artwork ? [96, 128, 192, 256, 384, 512].map((size) => ({ src: track.artwork!, sizes: `${size}x${size}` })) : [],
    });
    navigator.mediaSession.playbackState = usePlaybackStore.getState().isPlaying ? 'playing' : 'paused';
  }

  private updatePositionState(): void {
    if (!('mediaSession' in navigator) || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({ duration: this.audio.duration, playbackRate: this.audio.playbackRate, position: Math.min(this.audio.currentTime, this.audio.duration) });
    } catch { /* Safari can reject while metadata changes */ }
  }

  stop(): void {
    this.cancelFade();
    this.clearPrepared();
    this.roomUnsubscribe?.();
    this.unsubscribe?.();
    this.libraryUnsubscribe?.();
    this.unsubscribe = undefined;
    this.libraryUnsubscribe = undefined;
  }

  describe(): string {
    return `${formatDuration(this.audio.currentTime)} / ${formatDuration(this.audio.duration)}`;
  }
}

export const playbackEngine = new PlaybackEngine();
