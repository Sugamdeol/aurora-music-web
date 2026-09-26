import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYBACK_SETTINGS, type MediaTrack } from '../src/domain/media';
import { mixGains, transitionDuration } from '../src/lib/songTransitions';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import { useRoomStore } from '../src/room/client';
import type { PlaybackEngine } from '../src/lib/playbackEngine';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), streamCandidates: () => ['/test-audio'] }));
const tracks: MediaTrack[] = ['one', 'two', 'three'].map(id => ({ id, title: id, artist: 'Artist', kind: 'song', source: 'remote', durationSeconds: 200 }));

describe('transition planning', () => {
  it('keeps short clips and consecutive album songs intact in Auto Mix', () => {
    expect(transitionDuration(DEFAULT_PLAYBACK_SETTINGS, tracks[0], tracks[1], 8)).toBe(0);
    expect(transitionDuration(DEFAULT_PLAYBACK_SETTINGS, { ...tracks[0], album: 'Album' }, { ...tracks[1], album: 'Album' }, 200)).toBe(0);
    expect(transitionDuration(DEFAULT_PLAYBACK_SETTINGS, tracks[0], tracks[1], 200)).toBe(5);
  });
  it('bounds custom fade time and keeps equal power throughout the blend', () => {
    expect(transitionDuration({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'crossfade', crossfadeSeconds: 100 }, tracks[0], tracks[1], 200)).toBe(12);
    expect(transitionDuration({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'off' }, tracks[0], tracks[1], 200)).toBe(0);
    for (const progress of [0, .25, .5, .75, 1]) {
      const [outgoing, incoming] = mixGains(progress);
      expect(outgoing ** 2 + incoming ** 2).toBeCloseTo(1);
    }
  });
});

class AudioDeck extends EventTarget {
  src = ''; preload = ''; crossOrigin = ''; volume = 1; muted = false; playbackRate = 1;
  duration = 200; currentTime = 0; readyState = 4; paused = true; seeking = false; ended = false;
  load() { if (this.src) this.dispatchEvent(new Event('loadedmetadata')); }
  async play() { this.paused = false; this.dispatchEvent(new Event('playing')); }
  pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.dispatchEvent(new Event('pause')); }
  removeAttribute() { this.src = ''; }
  tick(time: number) { this.currentTime = time; this.dispatchEvent(new Event('timeupdate')); }
}
let engine: PlaybackEngine;
const recordPlay = useLibraryStore.getState().recordPlay;
const recordListenTime = useLibraryStore.getState().recordListenTime;
beforeEach(async () => {
  vi.stubGlobal('Audio', AudioDeck);
  usePlaybackStore.setState({ currentTrack: null, currentIndex: -1, queue: [], sourceRevision: 0, isPlaying: false, position: 0, duration: 0, repeat: 'off', shuffle: false, volume: .8, muted: false });
  useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'crossfade', crossfadeSeconds: 6 }, recordPlay: vi.fn().mockResolvedValue(1), recordListenTime: vi.fn().mockResolvedValue(undefined) });
  useRoomStore.setState({ status: 'disconnected' });
  const module = await import('../src/lib/playbackEngine');
  engine = new module.PlaybackEngine();
  engine.start();
});
afterEach(() => {
  engine.stop();
  vi.useRealTimers();
  useLibraryStore.setState({ recordPlay, recordListenTime });
  vi.unstubAllGlobals();
});
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('audio transitions', () => {
  it('blends both decks and releases the outgoing stream when the fade completes', async () => {
    vi.useFakeTimers();
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const outgoing = engine.audio as unknown as AudioDeck;
    outgoing.tick(195);
    await settle();
    const incoming = engine.audio as unknown as AudioDeck;
    incoming.tick(2.5);
    vi.advanceTimersByTime(50);
    expect(outgoing.volume).toBeCloseTo(.8 * Math.SQRT1_2);
    expect(incoming.volume).toBeCloseTo(.8 * Math.SQRT1_2);
    incoming.tick(5);
    vi.advanceTimersByTime(50);
    expect(outgoing.paused).toBe(true);
    expect(outgoing.src).toBe('');
    expect(incoming.volume).toBe(.8);
  });
  it('promotes the buffered next song and restores full volume when paused', async () => {
    usePlaybackStore.getState().playTracks(tracks, 0, 'Playlist');
    await settle();
    const outgoing = engine.audio as unknown as AudioDeck;
    outgoing.tick(195);
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('two');
    expect(engine.audio).not.toBe(outgoing);
    expect(outgoing.paused).toBe(false);
    expect(engine.audio.volume).toBe(0);
    usePlaybackStore.getState().pause();
    expect(outgoing.paused).toBe(true);
    expect(engine.audio.paused).toBe(true);
    expect(engine.audio.volume).toBe(.8);
  });
  it('skips transitions for repeat-one and listening rooms', async () => {
    usePlaybackStore.setState({ repeat: 'one' });
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    (engine.audio as unknown as AudioDeck).tick(195);
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('one');
    usePlaybackStore.setState({ repeat: 'off' });
    useRoomStore.setState({ status: 'connected' });
    (engine.audio as unknown as AudioDeck).tick(197);
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('one');
  });
  it('does not replace the current song when the next stream cannot start', async () => {
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const outgoing = engine.audio;
    const play = vi.spyOn(AudioDeck.prototype, 'play').mockRejectedValueOnce(new Error('Unavailable'));
    (outgoing as unknown as AudioDeck).tick(195);
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('one');
    expect(engine.audio).toBe(outgoing);
    expect(outgoing.volume).toBe(.8);
    play.mockRestore();
  });
});
