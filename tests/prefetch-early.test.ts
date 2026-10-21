import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYBACK_SETTINGS, type MediaTrack } from '../src/domain/media';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import { useRoomStore } from '../src/room/client';
import { prefetchTrack } from '../src/lib/api';
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

describe('next song is requested early', () => {
  it('asks the server for the next track as soon as playback starts', async () => {
    const asked: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    AudioDeck.instances = [];
    vi.stubGlobal('Audio', AudioDeck);
    usePlaybackStore.setState({
      currentTrack: null, currentIndex: -1, queue: [], sourceRevision: 0, isPlaying: false,
      position: 0, duration: 0, repeat: 'off', shuffle: false, volume: .8, muted: false,
      status: 'idle', error: undefined, autoplayEligible: false, fullPlayerOpen: false,
      activeSheet: null, nextReady: false,
    });
    useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' } });
    useRoomStore.setState({ status: 'disconnected' });
    const module = await import('../src/lib/playbackEngine');
    const engine = new module.PlaybackEngine();
    engine.start();
    try {
      usePlaybackStore.getState().playTracks(tracks);
      await settle();
      // The next track must be requested while the current one is still
      // playing, not at the end of the song.
      expect(usePlaybackStore.getState().isPlaying).toBe(true);
      expect(asked.some((url) => url.includes('/api/v1/prefetch/two'))).toBe(true);
    } finally {
      engine.stop();
      globalThis.fetch = original;
      vi.unstubAllGlobals();
    }
  });

  it('does not request a local file from the server', () => {
    const original = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    try {
      prefetchTrack({ ...tracks[0], source: 'local' });
      expect(asked).toHaveLength(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
