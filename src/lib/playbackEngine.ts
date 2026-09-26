import type { MediaTrack } from '../domain/media';
import { formatDuration } from '../domain/media';
import { db } from './db';
import { api, streamCandidates } from './api';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { EqualizerGraph } from './equalizer';

type StoreState = ReturnType<typeof usePlaybackStore.getState>;

class PlaybackEngine {
  readonly audio = new Audio();
  private unsubscribe?: () => void;
  private libraryUnsubscribe?: () => void;
  private currentKey = '';
  private loadRevision = 0;
  private audioContext?: AudioContext;
  private sourceNode?: MediaElementAudioSourceNode;
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
      if (state.playbackSettings !== previous.playbackSettings) this.configureNormalizer(state.playbackSettings.normalizeVolume);
    });
    this.configureNormalizer(useLibraryStore.getState().playbackSettings.normalizeVolume);
    this.applyState(usePlaybackStore.getState(), usePlaybackStore.getState());
    this.configureMediaSession();
    return () => this.stop();
  }

  private bindEvents(): void {
    const store = usePlaybackStore.getState;
    this.audio.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : store().currentTrack?.durationSeconds ?? 0;
      store().setDuration(duration);
      store().setStatus(this.audio.paused ? 'ready' : 'playing');
    });
    this.audio.addEventListener('durationchange', () => {
      if (Number.isFinite(this.audio.duration)) store().setDuration(this.audio.duration);
    });
    this.audio.addEventListener('timeupdate', () => {
      const position = this.audio.currentTime || 0;
      store().setPosition(position);
      const previous = this.lastListenPosition;
      if (!this.audio.paused && !this.audio.seeking && previous !== undefined && position >= previous) {
        this.pendingListenSeconds += (position - previous) / this.audio.playbackRate;
        if (this.pendingListenSeconds >= 10) this.flushListenTime();
      }
      this.lastListenPosition = position;
    });
    this.audio.addEventListener('waiting', () => { this.flushListenTime(); this.lastListenPosition = undefined; store().setStatus('loading'); });
    this.audio.addEventListener('canplay', () => store().setStatus(this.audio.paused ? 'ready' : 'playing'));
    this.audio.addEventListener('playing', () => {
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
    this.audio.addEventListener('pause', () => {
      this.flushListenTime();
      if (!this.audio.ended && store().status !== 'error') store().setStatus('paused');
    });
    this.audio.addEventListener('ended', () => { this.flushListenTime(); void this.handleEnded(); });
    this.audio.addEventListener('error', () => void this.handleSourceError());
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
    this.audio.volume = state.volume;
    this.audio.muted = state.muted;
    this.audio.playbackRate = state.playbackRate;
    const key = state.currentTrack ? `${state.currentTrack.id}:${state.sourceRevision}` : '';
    if (key !== this.currentKey) {
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
    if (liveState.autoplayEligible && liveState.queue.length === 1 && liveState.currentTrack?.source !== 'local') {
      void this.seedSuggestions(liveState.currentTrack!, `${liveState.currentTrack!.id}:${liveState.sourceRevision}`);
    }
    if (Math.abs((this.audio.currentTime || 0) - liveState.position) > 1.25 && Number.isFinite(liveState.position)) {
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
      this.sourceNode ??= this.audioContext.createMediaElementSource(this.audio);
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
