import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYBACK_SETTINGS, type MediaTrack } from '../src/domain/media';
import { mixGains, transitionDuration } from '../src/lib/songTransitions';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import { useRoomStore } from '../src/room/client';
import { api } from '../src/lib/api';
import type { PlaybackEngine } from '../src/lib/playbackEngine';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), streamCandidates: () => ['/test-audio'] }));
const tracks: MediaTrack[] = ['one', 'two', 'three'].map(id => ({ id, title: id, artist: 'Artist', kind: 'song', source: 'remote', durationSeconds: 200 }));

describe('transition planning', () => {
  it('keeps short clips and consecutive album songs intact in Auto Mix', () => {
    expect(transitionDuration(DEFAULT_PLAYBACK_SETTINGS, tracks[0], tracks[1], 8)).toBe(0);
    expect(transitionDuration(DEFAULT_PLAYBACK_SETTINGS, { ...tracks[0], album: 'Album' }, { ...tracks[1], album: 'Album' }, 200)).toBe(0);
    expect(transitionDuration(DEFAULT_PLAYBACK_SETTINGS, tracks[0], tracks[1], 200)).toBe(6);
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
let engine: PlaybackEngine;
const recordPlay = useLibraryStore.getState().recordPlay;
const recordListenTime = useLibraryStore.getState().recordListenTime;
beforeEach(async () => {
  AudioDeck.instances = [];
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
  vi.restoreAllMocks();
  useLibraryStore.setState({ recordPlay, recordListenTime });
  vi.unstubAllGlobals();
});
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('audio transitions', () => {
  it('buffers one next song early and reuses it when Next is tapped', async () => {
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const outgoing = engine.audio;
    const prepared = AudioDeck.instances.at(-1)!;
    expect(prepared).not.toBe(outgoing);
    expect(prepared.src).toBe('/test-audio');
    prepared.dispatchEvent(new Event('canplay'));
    expect(usePlaybackStore.getState().nextReady).toBe(true);
    usePlaybackStore.getState().next();
    await settle();
    expect(engine.audio).toBe(prepared);
    expect(prepared.paused).toBe(false);
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('two');
  });
  it('replaces a prepared deck when the next queue item changes', async () => {
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const oldPrepared = AudioDeck.instances.at(-1)!;
    usePlaybackStore.getState().reorderQueue(2, 1);
    await settle();
    expect(oldPrepared.src).toBe('');
    (engine.audio as unknown as AudioDeck).tick(195);
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('three');
  });
  it('keeps shuffle history across a crossfade', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    usePlaybackStore.setState({ shuffle: true, shuffleHistory: ['three'] });
    usePlaybackStore.getState().playTracks(tracks);
    usePlaybackStore.setState({ shuffleHistory: ['three'] });
    await settle();
    (engine.audio as unknown as AudioDeck).tick(195);
    await settle();
    expect(usePlaybackStore.getState().shuffleHistory).toEqual(['three', 'one']);
    usePlaybackStore.getState().previous();
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('one');
  });

  it('keeps adding unique songs after a playlist ends', async () => {
    useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'off', autoplay: true } });
    const fourth = { ...tracks[0], id: 'four', title: 'four' };
    const fifth = { ...tracks[0], id: 'five', title: 'five' };
    vi.spyOn(api, 'related').mockImplementation(async (id) => id === 'two' ? [tracks[0], tracks[1], fourth] : id === 'four' ? [fifth] : []);
    usePlaybackStore.getState().playTracks(tracks.slice(0, 2), 1, 'Playlist');
    await settle();
    expect(usePlaybackStore.getState().queue.map((track) => track.id)).toEqual(['one', 'two', 'four']);
    expect(usePlaybackStore.getState().queue[2].recommended).toBe(true);
    (engine.audio as unknown as AudioDeck).dispatchEvent(new Event('ended'));
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('four');
    await settle();
    expect(usePlaybackStore.getState().queue.map((track) => track.id)).toEqual(['one', 'two', 'four', 'five']);
    (engine.audio as unknown as AudioDeck).dispatchEvent(new Event('ended'));
    await settle();
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('five');
  });

  it('keeps user queued songs ahead of pending recommendations', async () => {
    useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'off', autoplay: true } });
    let resolve!: (tracks: MediaTrack[]) => void;
    vi.spyOn(api, 'related').mockImplementation(() => new Promise((done) => { resolve = done; }));
    usePlaybackStore.getState().playTracks([tracks[0]], 0, 'Single');
    await settle();
    usePlaybackStore.getState().addToQueue(tracks[1]);
    resolve([tracks[2]]);
    await settle();
    expect(usePlaybackStore.getState().queue.map((track) => track.id)).toEqual(['one', 'two']);
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('one');
  });
  it('uses separate Web Audio gains so fades work when mobile media volume is fixed', async () => {
    engine.stop();
    const deckGains: Array<{ gain: { value: number } }> = [];
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    class MobileAudioContext {
      state = 'running'; currentTime = 0; destination = node();
      createGain() { const gain = { ...node(), gain: { value: 1, setTargetAtTime: vi.fn() } }; deckGains.push(gain); return gain; }
      createMediaElementSource() { return node(); }
      createBiquadFilter() { return { ...node(), frequency: { value: 0 }, Q: { value: 0 }, gain: { setTargetAtTime: vi.fn() } }; }
      createDynamicsCompressor() { return { ...node(), threshold: { value: 0 }, knee: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } }; }
      async resume() { this.state = 'running'; }
    }
    vi.stubGlobal('AudioContext', MobileAudioContext);
    const module = await import('../src/lib/playbackEngine');
    engine = new module.PlaybackEngine();
    engine.start();
    vi.useFakeTimers();
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const outgoing = engine.audio as unknown as AudioDeck;
    outgoing.tick(195);
    await settle();
    const incoming = engine.audio as unknown as AudioDeck;
    incoming.tick(2.5);
    vi.advanceTimersByTime(50);
    expect(outgoing.volume).toBe(1);
    expect(incoming.volume).toBe(1);
    expect(deckGains[1].gain.value).toBeCloseTo(.8 * Math.SQRT1_2);
    expect(deckGains.at(-1)!.gain.value).toBeCloseTo(.8 * Math.SQRT1_2);
  });
  it('Auto Mix blends unrelated songs and preserves the gap between album tracks', async () => {
    useLibraryStore.setState({ playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' } });
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const outgoing = engine.audio as unknown as AudioDeck;
    outgoing.tick(195);
    await settle();
    expect(engine.audio).not.toBe(outgoing);

    usePlaybackStore.getState().playTracks([
      { ...tracks[0], album: 'One album' },
      { ...tracks[1], album: 'One album' },
    ]);
    await settle();
    const albumTrack = engine.audio as unknown as AudioDeck;
    albumTrack.tick(195);
    await settle();
    expect(engine.audio).toBe(albumTrack);
  });
  it('starts the fade when a slow next stream becomes playable inside the transition window', async () => {
    usePlaybackStore.getState().playTracks(tracks);
    await settle();
    const outgoing = engine.audio as unknown as AudioDeck;
    outgoing.tick(120);
    await settle();
    const incoming = AudioDeck.instances.at(-1)!;
    expect(incoming).not.toBe(outgoing);
    incoming.readyState = 1;
    outgoing.tick(195);
    await settle();
    expect(engine.audio).toBe(outgoing);
    incoming.readyState = 4;
    incoming.dispatchEvent(new Event('canplay'));
    await settle();
    expect(engine.audio).toBe(incoming);
  });
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

