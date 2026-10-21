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

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

async function bootEngine(analysis?: { blendStart: number; bpm?: number }): Promise<PlaybackEngine> {
  AudioDeck.instances = [];
  vi.stubGlobal('Audio', AudioDeck);
  // The server's analysis endpoint answers with the measured blend point.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown) => {
    const url = String((input as { url?: string })?.url ?? input);
    if (url.includes('/analysis/')) {
      return new Response(JSON.stringify({
        blendStart: analysis?.blendStart ?? 150,
        bpm: analysis?.bpm ?? 128,
        duration: 200,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 200 });
  }));
  usePlaybackStore.setState({
    currentTrack: null, currentIndex: -1, queue: [], sourceRevision: 0, isPlaying: false,
    position: 0, duration: 0, repeat: 'off', shuffle: false, volume: .8, muted: false,
    status: 'idle', error: undefined, autoplayEligible: false, fullPlayerOpen: false,
    activeSheet: null, nextReady: false, shuffleNextIndex: null, shuffleHistory: [],
  });
  useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' } });
  useRoomStore.setState({ status: 'disconnected' });
  const module = await import('../src/lib/playbackEngine');
  const engine = new module.PlaybackEngine();
  engine.start();
  return engine;
}

describe('Auto Mix uses the server analysis', () => {
  it('places the blend at the point the server measured, not a fixed window', () => {
    const plan = planTransition(
      { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' },
      tracks[0], tracks[1], 200,
      { blendStart: 152, bpm: 128 },
    );
    expect(plan).not.toBeNull();
    // The measured point wins, even though it is well before the default
    // 15 second outro window.
    expect(plan!.startAt).toBe(152);
  });

  it('ignores a measured point that is past the end of the track', () => {
    const plan = planTransition(
      { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' },
      tracks[0], tracks[1], 200,
      { blendStart: 199.9 },
    );
    expect(plan).not.toBeNull();
    expect(plan!.startAt).toBeLessThan(199.9);
  });

  it('starts the blend as soon as the measured point has passed', async () => {
    const engine = await bootEngine();
    try {
      usePlaybackStore.getState().playTracks(tracks);
      await settle();
      const outgoing = engine.audio as unknown as AudioDeck;
      // The server says the blend starts at 150 seconds. The player is
      // already past that point, so the blend must start right away.
      outgoing.tick(155);
      await settle();
      expect(engine.audio).not.toBe(outgoing);
    } finally { engine.stop(); vi.unstubAllGlobals(); }
  });
});
