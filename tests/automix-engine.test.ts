import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYBACK_SETTINGS, type MediaTrack } from '../src/domain/media';
import { planTransition } from '../src/lib/songTransitions';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import { useRoomStore } from '../src/room/client';
import type { PlaybackEngine } from '../src/lib/playbackEngine';

const tracks: MediaTrack[] = ['one', 'two'].map((id) => ({ id, title: id, artist: 'Artist', kind: 'song', source: 'remote', durationSeconds: 200 }));

class AudioDeck extends EventTarget {
  static instances: AudioDeck[] = [];
  src = ''; preload = ''; crossOrigin = ''; volume = 1; muted = false; playbackRate = 1;
  duration = 200; currentTime = 0; readyState = 4; paused = true; seeking = false; ended = false;
  constructor() { super(); AudioDeck.instances.push(this); }
  load() { if (this.src) this.dispatchEvent(new Event('loadedmetadata')); }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.dispatchEvent(new Event('pause')); }
  removeAttribute() { this.src = ''; }
  tick(time: number) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')); }
}

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

async function bootEngine(mode: 'automix' | 'crossfade' = 'automix'): Promise<PlaybackEngine> {
  AudioDeck.instances = [];
  vi.stubGlobal('Audio', AudioDeck);
  usePlaybackStore.setState({
    currentTrack: null, currentIndex: -1, queue: [], sourceRevision: 0, isPlaying: false,
    position: 0, duration: 0, repeat: 'off', shuffle: false, volume: .8, muted: false,
    status: 'idle', error: undefined, autoplayEligible: false, fullPlayerOpen: false,
    activeSheet: null, nextReady: false,
  });
  useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: mode } });
  useRoomStore.setState({ status: 'disconnected' });
  const module = await import('../src/lib/playbackEngine');
  const engine = new module.PlaybackEngine();
  engine.start();
  return engine;
}

describe('Auto Mix engine behaviour', () => {
  it('starts the blend at the planned point, not at the very end of the track', async () => {
    const engine = await bootEngine();
    try {
      usePlaybackStore.getState().playTracks(tracks);
      await settle();
      const outgoing = engine.audio as unknown as AudioDeck;
      const plan = planTransition(useLibraryStore.getState().playbackSettings, tracks[0], tracks[1], 200)!;
      expect(plan).not.toBeNull();
      // Before the planned point, the blend must not have started.
      outgoing.tick(Math.max(0, plan.startAt - 3));
      await settle();
      expect(engine.audio).toBe(outgoing);
      // Crossing the planned point starts the blend.
      outgoing.tick(plan.startAt + 0.3);
      await settle();
      expect(engine.audio).not.toBe(outgoing);
    } finally { engine.stop(); vi.unstubAllGlobals(); }
  });

  it('prepares the next song long before the current one ends', async () => {
    const engine = await bootEngine();
    try {
      usePlaybackStore.getState().playTracks(tracks);
      await settle();
      const outgoing = engine.audio as unknown as AudioDeck;
      const prepared = AudioDeck.instances.at(-1)!;
      expect(prepared).not.toBe(outgoing);
      // The next deck must already be buffering while the current song
      // still has a long way to run.
      expect(outgoing.currentTime).toBeLessThan(60);
      expect(prepared.src).not.toBe('');
    } finally { engine.stop(); vi.unstubAllGlobals(); }
  });

  it('keeps the album pair gapless even with Auto Mix on', async () => {
    const engine = await bootEngine();
    try {
      const albumTracks: MediaTrack[] = [
        { ...tracks[0], album: 'One album' },
        { ...tracks[1], album: 'One album' },
      ];
      usePlaybackStore.getState().playTracks(albumTracks);
      await settle();
      const first = engine.audio as unknown as AudioDeck;
      first.tick(196);
      await settle();
      expect(engine.audio).toBe(first);
    } finally { engine.stop(); vi.unstubAllGlobals(); }
  });
});
