import { buildTasteProfile, rankRecommendations } from './recommendations';
import { useRecommendationStore } from '../store/recommendations';
import type { MediaTrack } from '../domain/media';
import { formatDuration } from '../domain/media';
import { db } from './db';
import { api, streamCandidates, prefetchTrack, fetchTrackAnalysis, type TrackAnalysis } from './api';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { EqualizerGraph } from './equalizer';
import { useRoomStore } from '../room/client';
import { mixGains, planTransition } from './songTransitions';
import { estimateTempo, type EnergyProfile } from './trackAnalysis';
import { DEFAULT_SPATIAL_AUDIO, normalizeSpatialAudioSettings, readSpatialAudioSettings, spatialMotionAtPhase, stereoWidthCoefficients, type SpatialAudioSettings } from './spatialAudio';

type StoreState = ReturnType<typeof usePlaybackStore.getState>;
interface PreparedDeck { audio: HTMLAudioElement; track: MediaTrack; index: number; candidates: string[]; sourceIndex: number; objectUrl?: string }

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
  private prepared?: PreparedDeck;
  private preparationKey = '';
  private preparationRevision = 0;
  /** Measured energy shape per track, used to place Auto Mix blends. */
  private profiles = new Map<string, EnergyProfile>();
  /** The server's analysis of a track, which knows the whole song. */
  private serverAnalysis = new Map<string, TrackAnalysis>();
  private failedPreparationKey = '';
  private prepareRetryAt = 0;
  private startingMix = false;
  private fading?: { audio: HTMLAudioElement; objectUrl?: string; start: number; duration: number; outgoingGain: number; incomingGain: number; startedAt: number };
  private fadeTimer?: number;
  private compressor?: DynamicsCompressorNode;
  private equalizer?: EqualizerGraph;
  private widthSplitter?: ChannelSplitterNode;
  private widthMerger?: ChannelMergerNode;
  private widthLeftDirect?: GainNode;
  private widthLeftCross?: GainNode;
  private widthRightDirect?: GainNode;
  private widthRightCross?: GainNode;
  private spatialPanner?: StereoPannerNode;
  private spatialConvolver?: ConvolverNode;
  private spatialDry?: GainNode;
  private spatialWet?: GainNode;
  private spatialOutput?: GainNode;
  private spatialSettings: SpatialAudioSettings = DEFAULT_SPATIAL_AUDIO;
  private spatialFrame?: number;
  private finalOutputNode?: AudioNode;
  private recordingDestination?: MediaStreamAudioDestinationNode;
  private graphMode = '';
  private sourceCandidates: string[] = [];
  private sourceIndex = 0;
  private objectUrl?: string;
  private handledTrackId?: string;
  private historyRecordId?: number;
  private lastListenPosition?: number;
  private pendingListenSeconds = 0;
  private recommendationRequest?: { key: string; promise: Promise<void> };
  private recommendationAttemptKey = '';
  private lastWarmKey = '';
  private destroyed = false;
  private eventsBound = false;

  constructor() {
    this.audio.preload = 'metadata';
    this.audio.crossOrigin = 'anonymous';
    this.spatialSettings = readSpatialAudioSettings();
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
      // A seek requested before the stream was seekable (restored session
      // position, tapping the bar during load) is silently dropped by the
      // browser; re-apply the store's position now that we can.
      const wanted = store().position;
      if (wanted > 1.25 && Math.abs((this.audio.currentTime || 0) - wanted) > 1.25) {
        try { this.audio.currentTime = wanted; this.lastListenPosition = wanted; } catch { /* not seekable yet */ }
      }
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
      this.reportBuffered();
      void this.maybeTransition();
    });
    on('waiting', () => { if (!this.fading) this.cancelFade(); this.flushListenTime(); this.lastListenPosition = undefined; store().setStatus('loading'); });
    on('canplay', () => { store().setStatus(this.audio.paused ? 'ready' : 'playing'); void this.prepareNext(); });
    on('playing', () => {
      store().setStatus('playing');
      const track = store().currentTrack;
      if (track && this.handledTrackId !== track.id) {
        this.handledTrackId = track.id;
        this.lastListenPosition = this.audio.currentTime || 0;
        this.analyseTrack(track, this.audio);
        void this.loadServerAnalysis(track);
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
    on('progress', () => this.reportBuffered());
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
    this.syncSpatialMotion(state);
    // Buffer/readiness indicators are UI-only; avoid re-entering track loads.
    if ((state.nextReady !== previous.nextReady || state.buffered !== previous.buffered)
      && state.currentTrack === previous.currentTrack && state.queue === previous.queue
      && state.sourceRevision === previous.sourceRevision && state.isPlaying === previous.isPlaying
      && state.position === previous.position && state.duration === previous.duration
      && state.volume === previous.volume && state.muted === previous.muted
      && state.playbackRate === previous.playbackRate && state.shuffle === previous.shuffle && state.repeat === previous.repeat) return;
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
      if (state.isPlaying) void this.prepareNext();
      if (state.isPlaying && state.queue.length - state.currentIndex === 1) void this.ensureUpcoming();
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
      const reuse = this.prepared && this.prepared.track.id === state.currentTrack?.id && this.prepared.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA ? this.prepared : undefined;
      if (reuse) {
        this.prepared = undefined;
        this.preparationKey = '';
        this.preparationRevision += 1;
        this.releaseDeck(this.audio, this.objectUrl);
        this.activeAudio = reuse.audio;
        this.objectUrl = reuse.objectUrl;
        this.sourceCandidates = reuse.candidates;
        this.sourceIndex = reuse.sourceIndex;
        state.setNextReady(false);
        this.setDeckVolume(this.audio, state.volume);
      } else this.clearPrepared();
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
      if (!reuse) await this.loadTrack(state.currentTrack, revision);
      if (key !== this.currentKey) return;
    }
    const liveState = usePlaybackStore.getState();
    if (liveState.isPlaying) void this.ensureUpcoming();
    void this.prepareNext();
    // Do not fight the player's clock while a blend is running: the store
    // reports the incoming track's position while the fade is still in
    // progress, and seeking on that difference used to cancel the blend
    // halfway through, which is what made Auto Mix sound like a hard cut.
    if (!this.fading && Math.abs((this.audio.currentTime || 0) - liveState.position) > 1.25 && Number.isFinite(liveState.position)) {
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
    usePlaybackStore.getState().setNextReady(false);
  }

  private async prepareNext(): Promise<void> {
    if (this.fading) return;
    const state = usePlaybackStore.getState();
    const settings = useLibraryStore.getState().playbackSettings;
    // Always pre-buffer the next deck: with transitions on it becomes the
    // crossfade partner, with them off it is what makes track changes gapless.
    if (!state.currentTrack || state.repeat === 'one' || useRoomStore.getState().status === 'connected' || state.queue.length < 2) {
      if (this.preparationKey || this.prepared) this.clearPrepared();
      return;
    }
    // Start only once the selected song can play. Buffer one successor early
    // so slow extraction on a small server has the whole song to finish.
    if (!this.prepared && (!state.isPlaying || this.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)) return;
    const nextKey = state.shuffle ? state.queue.length : state.queue[state.currentIndex + 1]?.id ?? (state.repeat === 'all' ? state.queue[0]?.id : 'end');
    const fingerprint = state.queue.map(track => track.id).join('|');
    const key = `${this.currentKey}:${state.currentIndex}:${fingerprint}:${nextKey}:${state.shuffle}:${state.repeat}:${settings.transitionMode}:${settings.preferredQuality}:${Math.round(state.duration)}`;
    if (key === this.preparationKey || (key === this.failedPreparationKey && Date.now() < this.prepareRetryAt)) return;
    this.clearPrepared();
    this.preparationKey = key;
    const revision = this.preparationRevision;
    let index = state.currentIndex + 1;
    if (state.shuffle) {
      const choices = state.queue.map((_, i) => i).filter(i => i !== state.currentIndex);
      index = choices[Math.floor(Math.random() * choices.length)];
      // Tell the store which track is being prepared so it plays exactly
      // this one when the song ends, instead of shuffling again.
      state.setShuffleNextIndex(index);
    } else if (index >= state.queue.length && state.repeat === 'all') index = 0;
    const track = state.queue[index];
    if (!track) return;
    // Ask the server for the next track now, not when the current one is
    // nearly over: the download happens on the server while the listener is
    // still on the current song, so the handover is instant.
    if (track.source === 'remote') prefetchTrack(track, settings.preferredQuality);
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
    usePlaybackStore.getState().setNextReady(false);
    this.bindEvents(audio);
    this.connectDeck(audio);
    audio.addEventListener('canplay', () => {
      if (this.prepared === prepared) { usePlaybackStore.getState().setNextReady(true); void this.maybeTransition(); }
    });
    audio.addEventListener('error', () => {
      if (this.prepared !== prepared) return;
      if (prepared.sourceIndex + 1 < candidates.length) {
        audio.src = candidates[++prepared.sourceIndex];
        audio.load();
      } else {
        this.failedPreparationKey = key;
        this.prepareRetryAt = Date.now() + 15000;
        this.preparationKey = '';
        this.prepared = undefined;
        usePlaybackStore.getState().setNextReady(false);
        this.releaseDeck(audio, objectUrl);
      }
    });
    const nextSource = candidates[0] || '';
    audio.src = nextSource.startsWith('/api/v1/stream/') ? `${nextSource}${nextSource.includes('?') ? '&' : '?'}prefetch=1` : nextSource;
    audio.load();
  }

  private async maybeTransition(): Promise<void> {
    const state = usePlaybackStore.getState();
    const prepared = this.prepared;
    if (!prepared || this.startingMix || this.fading || !state.isPlaying || this.audio.paused || this.audio.seeking || state.repeat === 'one' || useRoomStore.getState().status === 'connected' || !state.currentTrack) return;
    const settings = useLibraryStore.getState().playbackSettings;
    const plan = planTransition(settings, state.currentTrack, prepared.track, this.audio.duration, this.profileFor(state.currentTrack));
    if (!plan) return;
    // The blend starts at the planned musical point, not at the last second
    // of the track: the transition is placed where the song breathes.
    const remaining = (this.audio.duration - this.audio.currentTime) / state.playbackRate;
    const untilPlan = (plan.startAt - this.audio.currentTime) / state.playbackRate;
    // The blend starts at the planned musical point, not at the last second
    // of the track: the transition is placed where the song breathes.
    //
    // The plan can move while the track is playing, because the server
    // analysis arrives after the track starts. When that happens the blend
    // point is in the past, so the transition must start right away instead
    // of waiting for a point that already passed.
    if (untilPlan > 0.15) return;
    const seconds = Math.min(plan.seconds, remaining);
    if (!seconds || remaining < .2 || prepared.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
    const outgoing = this.audio;
    const key = this.currentKey;
    // Publish the blend for the Auto Mix transition UI before the store
    // moves to the new track: the outgoing track reference is needed.
    const outgoingTrack = state.currentTrack;
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
      this.fading = { audio: outgoing, objectUrl: outgoingUrl, start: this.audio.currentTime, duration: Math.min(seconds, remaining) * state.playbackRate, outgoingGain: 1, incomingGain: 0, startedAt: performance.now() };
      usePlaybackStore.getState().setTransition({ active: true, progress: 0, from: outgoingTrack ?? null, to: prepared.track });
      const latest = usePlaybackStore.getState();
      this.currentKey = `${prepared.track.id}:${latest.sourceRevision + 1}`;
      const history = latest.shuffle && latest.currentTrack ? [...latest.shuffleHistory, latest.currentTrack.id].slice(-100) : latest.shuffleHistory;
      latest.playTracks(latest.queue, prepared.index, latest.contextLabel);
      usePlaybackStore.setState({ autoplayEligible: latest.autoplayEligible, shuffleHistory: history, nextReady: false });
      latest.setDuration(this.audio.duration);
      latest.setPosition(this.audio.currentTime);
      this.audio.dispatchEvent(new Event('playing'));
      this.fadeTimer = window.setInterval(() => {
        const fade = this.fading;
        if (!fade) return;
        // The blend is driven by the incoming deck's play head, because it
        // is the track the listener is now hearing. The wall clock is a
        // fallback: if the incoming stream stalls while buffering, the
        // blend still finishes instead of freezing the outgoing track at a
        // half faded volume.
        const byPosition = (this.audio.currentTime - fade.start) / fade.duration;
        const byClock = (performance.now() - fade.startedAt) / 1000 / fade.duration;
        const progress = Math.max(byPosition, byClock);
        const [outgoingGain, incomingGain] = mixGains(progress);
        fade.outgoingGain = outgoingGain;
        fade.incomingGain = incomingGain;
        const currentTransition = usePlaybackStore.getState().transition;
        usePlaybackStore.getState().setTransition({ ...currentTransition, active: true, progress: Math.min(1, progress) });
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
    const transition = usePlaybackStore.getState().transition;
    if (transition.active) usePlaybackStore.getState().setTransition({ active: false, progress: 0, from: null, to: null });
  }

  // Swap to the pre-buffered deck with no audible gap — used when transitions
  // are off or a planned crossfade never started. (An actively-past mix never
  // reaches here: the faded-out element no longer owns `ended`.)
  private adoptPrepared(prepared: PreparedDeck): void {
    const outgoing = this.audio;
    this.prepared = undefined;
    this.preparationKey = '';
    this.preparationRevision += 1;
    this.releaseDeck(outgoing, this.objectUrl);
    this.activeAudio = prepared.audio;
    this.objectUrl = prepared.objectUrl;
    this.sourceCandidates = prepared.candidates;
    this.sourceIndex = prepared.sourceIndex;
    this.handledTrackId = undefined;
    this.historyRecordId = undefined;
    this.pendingListenSeconds = 0;
    this.lastListenPosition = undefined;
    this.setDeckVolume(this.audio, usePlaybackStore.getState().volume);
    const latest = usePlaybackStore.getState();
    // playTracks bumps sourceRevision by exactly one; seeding the key first
    // lets applyState adopt this deck instead of reloading it.
    this.currentKey = `${prepared.track.id}:${latest.sourceRevision + 1}`;
    const history = latest.shuffle && latest.currentTrack ? [...latest.shuffleHistory, latest.currentTrack.id].slice(-100) : latest.shuffleHistory;
    latest.playTracks(latest.queue, prepared.index, latest.contextLabel);
    usePlaybackStore.setState({ autoplayEligible: latest.autoplayEligible, shuffleHistory: history, nextReady: false });
  }

  /**
   * Measures the energy shape of the track that is playing.
   *
   * The analyser is tapped on the deck's gain node, so the samples are the
   * music itself. The envelope is stored per track and later used to place
   * a blend where the song is quiet, which is what makes Auto Mix feel
   * musical rather than mechanical.
   */
  private analyseTrack(track: MediaTrack, audio: HTMLAudioElement): void {
    if (!this.audioContext || this.profiles.has(track.id)) return;
    const gain = this.deckGains.get(audio);
    if (!gain) return;
    let analyser: AnalyserNode;
    try {
      analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      gain.connect(analyser);
    } catch {
      return;
    }
    const buckets = 600;
    const energy = new Float32Array(buckets);
    const samples = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const sampleRate = this.audioContext.sampleRate;
    const perBucket = Math.max(1, Math.floor(sampleRate / buckets * 4));
    let bucket = 0;
    let count = 0;
    let peak = 0;
    const collect = (): void => {
      if (bucket >= buckets) { this.finishProfile(track, energy, sampleRate, peak, analyser, gain); return; }
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const value = (samples[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / samples.length);
      energy[bucket] = rms;
      if (rms > peak) peak = rms;
      bucket += 1;
      frame += 1;
      count += 1;
      if (count >= perBucket) { count = 0; bucket += 1; }
      requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  }

  private finishProfile(
    track: MediaTrack,
    energy: Float32Array,
    sampleRate: number,
    peak: number,
    analyser: AnalyserNode,
    gain: GainNode,
  ): void {
    try { gain.disconnect(analyser); } catch { /* already disconnected */ }
    if (peak <= 0) return;
    for (let i = 0; i < energy.length; i += 1) energy[i] /= peak;
    const durationSeconds = track.durationSeconds ?? 0;
    const measured: EnergyProfile = {
      energy,
      sampleRate: durationSeconds > 0 ? energy.length / durationSeconds : sampleRate,
      durationSeconds,
    };
    const bpm = estimateTempo(energy, measured.sampleRate);
    this.profiles.set(track.id, bpm ? { ...measured, bpm } : measured);
  }

  /**
   * Loads the server's analysis of a track.
   *
   * The server measures the whole file, so it knows the tempo and where the
   * song breathes before it ends. Without it the blend can only be guessed
   * from the part the browser has already heard, which is why the outro
   * break was never found.
   */
  private async loadServerAnalysis(track: MediaTrack): Promise<void> {
    if (track.source === 'local' || !track.id || this.serverAnalysis.has(track.id)) return;
    const analysis = await fetchTrackAnalysis(track);
    if (!analysis) return;
    this.serverAnalysis.set(track.id, analysis);
    // The blend point may have moved, so the plan has to be re-checked.
    void this.maybeTransition();
  }

  /**
   * The measured shape of a track, used to place a blend musically.
   * Falls back to an empty profile when the track has not been analysed.
   */
  private profileFor(track: MediaTrack): { energy?: Float32Array; bpm?: number; blendStart?: number; outroStart?: number } {
    const server = this.serverAnalysis.get(track.id);
    const profile = this.profiles.get(track.id);
    if (server) {
      // The server measured the whole track, so its blend point wins.
      return {
        energy: profile?.energy,
        bpm: server.bpm ?? profile?.bpm,
        blendStart: server.blendStart,
        outroStart: server.outroStart,
      };
    }
    if (!profile) return {};
    return { energy: profile.energy, bpm: profile.bpm };
  }

  private reportBuffered(): void {
    // TimeRanges is missing on some test doubles and exotic embedders — this
    // must never take down the playback event chain.
    try {
      const audio = this.audio;
      const ranges = audio.buffered;
      if (!ranges?.length) { usePlaybackStore.getState().setBuffered(0); return; }
      const position = audio.currentTime || 0;
      let end = 0;
      for (let range = 0; range < ranges.length; range += 1) {
        if (ranges.start(range) <= position + 0.5 && ranges.end(range) >= position - 0.5) {
          end = Math.max(end, ranges.end(range));
        }
      }
      usePlaybackStore.getState().setBuffered(end);
    } catch { /* best-effort UI affordance */ }
  }

  private async handleEnded(): Promise<void> {
    const playback = usePlaybackStore.getState();
    const prepared = this.prepared;
    if (prepared && !this.fading && playback.repeat !== 'one' && playback.queue[prepared.index]?.id === prepared.track.id && prepared.audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      this.adoptPrepared(prepared);
      return;
    }
    const atQueueEnd = playback.currentIndex >= playback.queue.length - 1;
    const autoplay = useLibraryStore.getState().playbackSettings.autoplay;
    if (!atQueueEnd || playback.repeat !== 'off' || !autoplay || !playback.currentTrack || playback.currentTrack.source === 'local' || useRoomStore.getState().status === 'connected') {
      playback.next(true);
      return;
    }
    playback.setStatus('loading');
    await this.ensureUpcoming(true);
    const latest = usePlaybackStore.getState();
    if (latest.currentTrack?.id === playback.currentTrack.id && latest.sourceRevision === playback.sourceRevision && latest.isPlaying) latest.next(true);
  }

  private ensureUpcoming(atEnd = false): Promise<void> {
    const state = usePlaybackStore.getState();
    if (!state.isPlaying || state.repeat !== 'off' || !useLibraryStore.getState().playbackSettings.autoplay
      || useRoomStore.getState().status === 'connected' || state.queue.length - state.currentIndex !== 1) return Promise.resolve();
    const tail = state.queue.at(-1);
    if (!tail || tail.source !== 'remote') return Promise.resolve();
    const key = `${state.queue[0]?.id}:${tail.id}:${state.sourceRevision}`;
    if (this.recommendationRequest?.key === key) return this.recommendationRequest.promise;
    if (!atEnd && this.recommendationAttemptKey === key) return Promise.resolve();
    this.recommendationAttemptKey = key;
    const promise = (async () => {
      const seen = new Set(state.queue.map((track) => track.id));
      const library = useLibraryStore.getState();
      // Use the already loaded library so extending the queue never waits on IndexedDB.
      const profile = buildTasteProfile(library.likedTracks, library.recent.map((track) => ({ trackId: track.id, artist: track.artist, playedAt: track.lastPlayedAt ?? 0 })));
      const rank = (tracks: MediaTrack[]) => rankRecommendations(tracks, profile, useRecommendationStore.getState(), { exclude: state.queue, limit: 20 });
      for (const seed of [tail, state.queue.at(-2)].filter((track): track is MediaTrack => Boolean(track && track.source === 'remote'))) {
        try {
          const related = rank(await api.related(seed.id));
          if (related.length) {
            usePlaybackStore.getState().appendRecommendations(related, tail.id);
            return;
          }
        } catch { /* Try another song or a music search. */ }
      }
      try {
        const results = await api.search(`${tail.artist} songs`, 'song');
        usePlaybackStore.getState().appendRecommendations(rank(results.filter((item): item is MediaTrack => 'source' in item && !seen.has(item.id))), tail.id);
      } catch { /* No online suggestions available; end this queue normally. */ }
    })();
    this.recommendationRequest = { key, promise };
    void promise.finally(() => { if (this.recommendationRequest?.promise === promise) this.recommendationRequest = undefined; });
    return promise;
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
      this.ensureSpatialNodes();
      const mode = `${enabled}:${settings.equalizerEnabled}`;
      if (this.graphMode === mode) return;
      this.sourceNode.disconnect();
      this.compressor.disconnect();
      this.spatialOutput?.disconnect();
      let output: AudioNode = settings.equalizerEnabled ? this.equalizer.connect(this.sourceNode) : this.sourceNode;
      output.connect(this.widthSplitter!);
      output = this.spatialOutput!;
      if (enabled) { output.connect(this.compressor); output = this.compressor; }
      output.connect(this.audioContext.destination);
      if (this.recordingDestination) output.connect(this.recordingDestination);
      this.finalOutputNode = output;
      this.graphMode = mode;
    } catch {
      try { this.sourceNode?.disconnect(); this.sourceNode?.connect(this.audioContext!.destination); this.graphMode = ''; } catch { /* Keep the original media element available. */ }
      // Some browsers disallow media-element graph creation; native playback remains available.
    }
  }

  private ensureSpatialNodes(): void {
    const context = this.audioContext;
    if (!context) return;
    if (!this.widthSplitter) {
      this.widthSplitter = context.createChannelSplitter(2);
      this.widthMerger = context.createChannelMerger(2);
      this.widthLeftDirect = context.createGain();
      this.widthLeftCross = context.createGain();
      this.widthRightDirect = context.createGain();
      this.widthRightCross = context.createGain();
      this.widthSplitter.connect(this.widthLeftDirect, 0);
      this.widthLeftDirect.connect(this.widthMerger, 0, 0);
      this.widthSplitter.connect(this.widthLeftCross, 1);
      this.widthLeftCross.connect(this.widthMerger, 0, 0);
      this.widthSplitter.connect(this.widthRightCross, 0);
      this.widthRightCross.connect(this.widthMerger, 0, 1);
      this.widthSplitter.connect(this.widthRightDirect, 1);
      this.widthRightDirect.connect(this.widthMerger, 0, 1);
      this.spatialPanner = context.createStereoPanner();
      this.spatialConvolver = context.createConvolver();
      this.spatialConvolver.buffer = this.createRoomImpulse(context, 1.65, 3.2);
      this.spatialDry = context.createGain();
      this.spatialWet = context.createGain();
      this.spatialOutput = context.createGain();
      this.widthMerger.connect(this.spatialPanner);
      this.spatialPanner.connect(this.spatialDry);
      this.spatialDry.connect(this.spatialOutput);
      this.spatialPanner.connect(this.spatialConvolver);
      this.spatialConvolver.connect(this.spatialWet);
      this.spatialWet.connect(this.spatialOutput);
    }
    this.applySpatialSettings();
  }

  private createRoomImpulse(context: AudioContext, seconds: number, decay: number): AudioBuffer {
    const length = Math.floor(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      const offset = channel ? 0.17 : 0;
      for (let index = 0; index < length; index += 1) {
        const age = Math.max(0, index / length - offset);
        data[index] = (Math.random() * 2 - 1) * Math.pow(1 - age, decay);
      }
    }
    return impulse;
  }

  private applySpatialSettings(): void {
    const enabled = this.spatialSettings.enabled;
    const [direct, cross] = stereoWidthCoefficients(this.spatialSettings.width, enabled);
    if (this.widthLeftDirect) this.widthLeftDirect.gain.value = direct;
    if (this.widthRightDirect) this.widthRightDirect.gain.value = direct;
    if (this.widthLeftCross) this.widthLeftCross.gain.value = cross;
    if (this.widthRightCross) this.widthRightCross.gain.value = cross;
    if (this.spatialDry) this.spatialDry.gain.value = enabled ? .92 : 1;
    if (this.spatialWet) this.spatialWet.gain.value = enabled ? (this.spatialSettings.reverb / 100) * .72 : 0;
    if (this.spatialPanner) this.spatialPanner.pan.value = enabled ? this.spatialSettings.pan / 100 : 0;
  }

  setSpatialAudioSettings(settings: SpatialAudioSettings): void {
    this.cancelSpatialMotion();
    this.spatialSettings = normalizeSpatialAudioSettings(settings);
    this.applySpatialSettings();
    this.syncSpatialMotion();
  }

  private cancelSpatialMotion(): void {
    if (this.spatialFrame !== undefined && typeof window !== 'undefined') window.cancelAnimationFrame(this.spatialFrame);
    this.spatialFrame = undefined;
  }

  private syncSpatialMotion(state: StoreState = usePlaybackStore.getState()): void {
    const moving = this.spatialSettings.enabled && this.spatialSettings.motion !== 'manual' && state.isPlaying;
    if (!moving || !this.spatialPanner || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      this.cancelSpatialMotion();
      if (this.spatialPanner) this.spatialPanner.pan.value = moving ? 0 : this.spatialSettings.enabled && this.spatialSettings.motion === 'manual' ? this.spatialSettings.pan / 100 : 0;
      return;
    }
    if (this.spatialFrame !== undefined) return;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const current = usePlaybackStore.getState();
      if (!this.spatialSettings.enabled || this.spatialSettings.motion === 'manual' || !current.isPlaying || !this.spatialPanner) {
        this.spatialFrame = undefined;
        if (this.spatialPanner) this.spatialPanner.pan.value = this.spatialSettings.enabled && this.spatialSettings.motion === 'manual' ? this.spatialSettings.pan / 100 : 0;
        return;
      }
      const phase = ((now - startedAt) / 1000) * this.spatialSettings.speed * Math.PI * 2;
      this.spatialPanner.pan.value = spatialMotionAtPhase(this.spatialSettings, phase).pan;
      this.spatialFrame = window.requestAnimationFrame(animate);
    };
    this.spatialFrame = window.requestAnimationFrame(animate);
  }

  createProcessedMediaStream(): MediaStream | null {
    if (!this.audioContext || !this.finalOutputNode || !('MediaStreamAudioDestinationNode' in window)) return null;
    try {
      this.recordingDestination = this.audioContext.createMediaStreamDestination();
      this.finalOutputNode.connect(this.recordingDestination);
      return this.recordingDestination.stream;
    } catch {
      this.recordingDestination = undefined;
      return null;
    }
  }

  releaseProcessedMediaStream(): void {
    const destination = this.recordingDestination;
    if (!destination) return;
    try { this.finalOutputNode?.disconnect(destination); } catch { /* The graph may have changed while recording. */ }
    destination.stream.getTracks().forEach((track) => track.stop());
    this.recordingDestination = undefined;
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
    this.cancelSpatialMotion();
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

