import { create } from 'zustand';
import type { MediaTrack, PlaybackStatus, RepeatMode } from '../domain/media';
import { getSetting, setSetting } from '../lib/db';

export type PlayerSheet = 'queue' | 'sleep' | 'equalizer' | null;

interface PersistedQueue {
  tracks: MediaTrack[];
  index: number;
  position?: number;
}

interface PlaybackState {
  ready: boolean;
  queue: MediaTrack[];
  currentIndex: number;
  currentTrack: MediaTrack | null;
  contextLabel: string;
  autoplayEligible: boolean;
  isPlaying: boolean;
  status: PlaybackStatus;
  error?: string;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Track ids played under shuffle (session-only) so Previous walks what you actually heard. */
  shuffleHistory: string[];
  buffered: number;
  nextReady: boolean;
  setNextReady: (ready: boolean) => void;
  fullPlayerOpen: boolean;
  activeSheet: PlayerSheet;
  sourceRevision: number;
  bootstrap: () => Promise<void>;
  playTracks: (tracks: MediaTrack[], startIndex?: number, contextLabel?: string) => void;
  playTrack: (track: MediaTrack, context?: MediaTrack[], contextLabel?: string, exactIndex?: number) => void;
  syncQueue: (tracks: MediaTrack[], currentTrackId?: string) => void;
  togglePlayback: () => void;
  play: () => void;
  pause: () => void;
  next: (automatic?: boolean) => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setPosition: (seconds: number) => void;
  setDuration: (seconds: number) => void;
  setStatus: (status: PlaybackStatus, error?: string) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setBuffered: (seconds: number) => void;
  setPlaybackRate: (rate: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  addToQueue: (track: MediaTrack, next?: boolean) => void;
  appendRecommendations: (tracks: MediaTrack[], expectedTailId: string) => number;
  removeFromQueue: (index: number) => void;
  reorderQueue: (from: number, to: number) => void;
  clearQueue: () => void;
  clearUpcoming: () => void;
  retrySource: () => void;
  openFullPlayer: (open?: boolean) => void;
  openSheet: (sheet: PlayerSheet) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
let saveTimer: number | undefined;
// Signed remote URLs expire; local file ids must survive a device restart.
function storable(track: MediaTrack): MediaTrack {
  const { streamUrl: _streamUrl, ...safe } = track;
  return safe;
}
function persist(state: Pick<PlaybackState, 'queue' | 'currentIndex' | 'volume' | 'shuffle' | 'repeat'>): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void Promise.all([
      setSetting('queue', { tracks: state.queue.map(storable), index: state.currentIndex, position: usePlaybackStore.getState().position }),
      setSetting('queue.position', { trackId: usePlaybackStore.getState().currentTrack?.id, position: usePlaybackStore.getState().position }),
      setSetting('volume', state.volume),
      setSetting('shuffle', state.shuffle),
      setSetting('repeat', state.repeat),
    ]);
  }, 150);
}
let positionSaveTimer: number | undefined;
function persistPosition(_position: number): void {
  // Throttle rather than debounce: continuous timeupdate events must still save.
  if (positionSaveTimer !== undefined) return;
  positionSaveTimer = window.setTimeout(() => {
    positionSaveTimer = undefined;
    const { currentTrack, position } = usePlaybackStore.getState();
    void setSetting('queue.position', { trackId: currentTrack?.id, position });
  }, 4_000);
}

function updateCurrent(queue: MediaTrack[], index: number): Pick<PlaybackState, 'queue' | 'currentIndex' | 'currentTrack'> {
  const safeIndex = queue.length ? clamp(index, 0, queue.length - 1) : -1;
  return { queue, currentIndex: safeIndex, currentTrack: safeIndex >= 0 ? queue[safeIndex] : null };
}

export const usePlaybackStore = create<PlaybackState>((set, get) => ({
  ready: false,
  queue: [],
  currentIndex: -1,
  currentTrack: null,
  contextLabel: 'Aurora Music',
  autoplayEligible: false,
  isPlaying: false,
  status: 'idle',
  position: 0,
  duration: 0,
  volume: 0.82,
  muted: false,
  playbackRate: 1,
  shuffle: false,
  repeat: 'off',
  shuffleHistory: [],
  buffered: 0,
  nextReady: false,
  setNextReady: (nextReady) => { if (get().nextReady !== nextReady) set({ nextReady }); },
  fullPlayerOpen: false,
  activeSheet: null,
  sourceRevision: 0,

  bootstrap: async () => {
    const [savedQueue, savedPosition, volume, shuffle, repeat, playbackRate] = await Promise.all([
      getSetting<PersistedQueue>('queue', { tracks: [], index: -1 }),
      getSetting<number | { trackId?: string; position: number }>('queue.position', 0),
      getSetting<number>('volume', 0.82),
      getSetting<boolean>('shuffle', false),
      getSetting<RepeatMode>('repeat', 'off'),
      getSetting<number>('player.speed', 1),
    ]);
    const current = updateCurrent(savedQueue.tracks ?? [], savedQueue.index ?? -1);
    // Resume mid-track: the engine seeks once metadata loads (see its
    // loadedmetadata handler), so restoring the position here is enough.
    const duration = current.currentTrack?.durationSeconds ?? 0;
    const matchingPosition = typeof savedPosition === 'object' && savedPosition?.trackId === current.currentTrack?.id ? savedPosition.position : undefined;
    const saved = Number.isFinite(matchingPosition) ? matchingPosition! : savedQueue.position ?? 0;
    const position = current.currentTrack ? (duration ? clamp(saved, 0, duration) : saved) : 0;
    set({ ...current, ready: true, volume: clamp(volume, 0, 1), shuffle, repeat: ['off', 'all', 'one'].includes(repeat) ? repeat : 'off', playbackRate: Number.isFinite(playbackRate) ? clamp(playbackRate, .5, 2) : 1, position, duration });
  },

  playTracks: (tracks, startIndex = 0, contextLabel = 'Queue') => {
    if (!tracks.length) return;
    const current = updateCurrent([...tracks], startIndex);
    set({ ...current, contextLabel, autoplayEligible: false, isPlaying: true, status: 'loading', error: undefined, position: 0, buffered: 0, shuffleHistory: [], duration: current.currentTrack?.durationSeconds ?? 0, sourceRevision: get().sourceRevision + 1 });
    persist({ ...get(), ...current });
  },

  playTrack: (track, context = [], contextLabel = 'Single track', exactIndex) => {
    const tracks = context.length ? [...context] : [track];
    let index = exactIndex !== undefined && tracks[exactIndex]?.id === track.id ? exactIndex : tracks.findIndex((item) => item.id === track.id);
    if (index < 0) { tracks.unshift(track); index = 0; }
    get().playTracks(tracks, index, contextLabel);
    set({ autoplayEligible: tracks.length === 1 });
  },

  syncQueue: (tracks, currentTrackId) => {
    const state = get();
    if (!tracks.length) { get().clearQueue(); return; }
    const requestedId = currentTrackId || state.currentTrack?.id;
    const index = Math.max(0, requestedId ? tracks.findIndex((track) => track.id === requestedId) : state.currentIndex);
    const next = updateCurrent([...tracks], index);
    const changedTrack = next.currentTrack?.id !== state.currentTrack?.id;
    set({ ...next, autoplayEligible: false, position: changedTrack ? 0 : state.position, duration: changedTrack ? next.currentTrack?.durationSeconds ?? 0 : state.duration, sourceRevision: changedTrack ? state.sourceRevision + 1 : state.sourceRevision });
    persist({ ...state, ...next });
  },

  togglePlayback: () => {
    if (!get().currentTrack && get().queue.length) {
      const current = updateCurrent(get().queue, 0);
      set({ ...current, isPlaying: true, status: 'loading', sourceRevision: get().sourceRevision + 1 });
      return;
    }
    if (!get().currentTrack) return;
    if (get().status === 'error') { get().retrySource(); return; }
    set((state) => ({ isPlaying: !state.isPlaying, status: state.isPlaying ? 'paused' : 'loading', error: undefined }));
  },
  play: () => {
    if (!get().currentTrack) return;
    if (get().status === 'error') { get().retrySource(); return; }
    set({ isPlaying: true, status: 'loading', error: undefined });
  },
  pause: () => set({ isPlaying: false, status: 'paused' }),

  next: (automatic = false) => {
    const state = get();
    if (!state.queue.length) return;
    if (automatic && state.repeat === 'one') {
      set({ position: 0, isPlaying: true, sourceRevision: state.sourceRevision + 1, status: 'loading' });
      return;
    }
    let index: number;
    let shuffleHistory = state.shuffleHistory;
    if (state.shuffle && state.queue.length > 1) {
      do { index = Math.floor(Math.random() * state.queue.length); } while (index === state.currentIndex);
      if (state.currentTrack) shuffleHistory = [...state.shuffleHistory, state.currentTrack.id].slice(-100);
    } else {
      index = state.currentIndex + 1;
      if (index >= state.queue.length) {
        if (state.repeat === 'all') index = 0;
        else { set({ isPlaying: false, status: 'paused', position: state.duration }); return; }
      }
    }
    const current = updateCurrent(state.queue, index);
    set({ ...current, isPlaying: true, status: 'loading', error: undefined, position: 0, duration: current.currentTrack?.durationSeconds ?? 0, sourceRevision: state.sourceRevision + 1, shuffleHistory, buffered: 0 });
    persist({ ...state, ...current });
  },

  previous: () => {
    const state = get();
    if (state.position > 4) { set({ position: 0 }); return; }
    if (!state.queue.length) return;
    // Under shuffle, walk back through what actually played (dropping ids that
    // no longer exist in the queue), not just the previous row.
    if (state.shuffle && state.shuffleHistory.length) {
      const history = [...state.shuffleHistory];
      while (history.length) {
        const id = history.pop()!;
        const index = state.queue.findIndex((track, i) => track.id === id && i !== state.currentIndex);
        if (index < 0) continue;
        const current = updateCurrent(state.queue, index);
        set({ ...current, isPlaying: true, status: 'loading', position: 0, duration: current.currentTrack?.durationSeconds ?? 0, sourceRevision: state.sourceRevision + 1, shuffleHistory: history, buffered: 0 });
        persist({ ...state, ...current });
        return;
      }
    }
    const index = state.currentIndex > 0 ? state.currentIndex - 1 : state.repeat === 'all' ? state.queue.length - 1 : 0;
    const current = updateCurrent(state.queue, index);
    set({ ...current, isPlaying: true, status: 'loading', position: 0, duration: current.currentTrack?.durationSeconds ?? 0, sourceRevision: state.sourceRevision + 1, buffered: 0 });
    persist({ ...state, ...current });
  },

  seek: (seconds) => {
    if (!Number.isFinite(seconds)) return;
    set({ position: clamp(seconds, 0, get().duration || Infinity) });
  },
  setPosition: (position) => { set({ position }); if (get().currentTrack) persistPosition(position); },
  setDuration: (duration) => set({ duration: Number.isFinite(duration) ? duration : 0 }),
  setStatus: (status, error) => set({ status, error }),
  setVolume: (volume) => { set({ volume: clamp(volume, 0, 1), muted: false }); persist(get()); },
  toggleMute: () => set((state) => ({ muted: !state.muted })),
  setBuffered: (seconds) => { if (Number.isFinite(seconds)) set({ buffered: seconds }); },
  // Shuffle history is per-session context; a fresh queue or toggle resets it.
  toggleShuffle: () => { set((state) => ({ shuffle: !state.shuffle, shuffleHistory: [] })); persist(get()); },
  setPlaybackRate: (rate) => {
    if (!Number.isFinite(rate)) return;
    const playbackRate = clamp(rate, .5, 2);
    set({ playbackRate });
    void setSetting('player.speed', playbackRate);
  },
  cycleRepeat: () => {
    set((state) => ({ repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off' }));
    persist(get());
  },

  addToQueue: (track, next = false) => {
    const state = get();
    const queue = [...state.queue];
    const insertAt = next && state.currentIndex >= 0 ? state.currentIndex + 1 : queue.length;
    queue.splice(insertAt, 0, track);
    const current = updateCurrent(queue, state.currentIndex < 0 ? 0 : state.currentIndex);
    // Queueing into an idle player should start playing, not surface a paused
    // dock with no explanation.
    const wasIdle = state.currentIndex < 0;
    set({ ...current, autoplayEligible: false, ...(wasIdle ? { isPlaying: true, status: 'loading' as const, error: undefined, sourceRevision: state.sourceRevision + 1 } : {}) });
    persist({ ...state, ...current });
  },

  appendRecommendations: (tracks, expectedTailId) => {
    const state = get();
    if (!state.queue.length || state.queue.at(-1)?.id !== expectedTailId) return 0;
    const seen = new Set(state.queue.map((track) => track.id));
    const newTracks = tracks.filter((track) => {
      if (track.source !== 'remote' || seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    }).slice(0, 20).map((track) => ({ ...track, recommended: true }));
    if (!newTracks.length) return 0;
    const queue = [...state.queue, ...newTracks];
    set({ queue });
    persist({ ...state, queue });
    return newTracks.length;
  },

  removeFromQueue: (index) => {
    const state = get();
    if (index < 0 || index >= state.queue.length) return;
    const queue = state.queue.filter((_, itemIndex) => itemIndex !== index);
    let currentIndex = state.currentIndex;
    let revision = state.sourceRevision;
    if (index < currentIndex) currentIndex -= 1;
    else if (index === currentIndex) { currentIndex = Math.min(currentIndex, queue.length - 1); revision += 1; }
    const current = updateCurrent(queue, currentIndex);
    set({ ...current, autoplayEligible: false, sourceRevision: revision, isPlaying: queue.length ? state.isPlaying : false, status: queue.length ? (index === state.currentIndex ? 'loading' : state.status) : 'idle', ...(index === state.currentIndex ? { position: 0, buffered: 0, duration: current.currentTrack?.durationSeconds ?? 0, error: undefined } : {}) });
    persist({ ...state, ...current });
  },

  reorderQueue: (from, to) => {
    const state = get();
    if (from === to || from < 0 || to < 0 || from >= state.queue.length || to >= state.queue.length) return;
    const queue = [...state.queue];
    const [moved] = queue.splice(from, 1);
    queue.splice(to, 0, moved);
    let currentIndex = state.currentIndex;
    if (from === currentIndex) currentIndex = to;
    else if (from < currentIndex && to >= currentIndex) currentIndex -= 1;
    else if (from > currentIndex && to <= currentIndex) currentIndex += 1;
    const current = updateCurrent(queue, currentIndex);
    set(current);
    persist({ ...state, ...current });
  },

  clearUpcoming: () => {
    const state = get();
    if (state.currentIndex < 0) return;
    const queue = state.queue.slice(0, state.currentIndex + 1);
    set({ queue, autoplayEligible: false });
    persist({ ...state, queue });
  },
  clearQueue: () => {
    const current = updateCurrent([], -1);
    set({ ...current, autoplayEligible: false, isPlaying: false, status: 'idle', position: 0, duration: 0, buffered: 0, shuffleHistory: [], fullPlayerOpen: false, activeSheet: null, sourceRevision: get().sourceRevision + 1 });
    persist({ ...get(), ...current });
  },
  retrySource: () => set((state) => ({ sourceRevision: state.sourceRevision + 1, isPlaying: true, status: 'loading', error: undefined })),
  openFullPlayer: (open) => set((state) => ({ fullPlayerOpen: open ?? !state.fullPlayerOpen, activeSheet: open === false ? null : state.activeSheet })),
  openSheet: (activeSheet) => set({ activeSheet }),
}));
