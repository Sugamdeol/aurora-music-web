import { describe, expect, it, beforeEach } from 'vitest';
import { usePlaybackStore } from '../src/store/playback';
import type { MediaTrack } from '../src/domain/media';

function track(id: string): MediaTrack {
  return {
    id,
    kind: 'song',
    title: `Track ${id}`,
    artist: 'Artist',
    album: 'Album',
    durationSeconds: 180,
    artwork: `https://example.invalid/${id}.jpg`,
    source: 'remote',
  };
}

describe('shuffle preloaded next track', () => {
  beforeEach(() => {
    usePlaybackStore.setState({
      queue: [track('a'), track('b'), track('c'), track('d')],
      currentIndex: 0,
      currentTrack: track('a'),
      shuffle: true,
      shuffleNextIndex: null,
      shuffleHistory: [],
      position: 0,
      duration: 180,
      isPlaying: false,
      status: 'paused',
      sourceRevision: 0,
    });
  });

  it('plays the track the engine already prepared instead of shuffling again', () => {
    // Repeat so a lucky random draw cannot make this pass by accident.
    for (let round = 0; round < 20; round += 1) {
      usePlaybackStore.setState({
        queue: [track('a'), track('b'), track('c'), track('d')],
        currentIndex: 0,
        currentTrack: track('a'),
        shuffle: true,
        shuffleNextIndex: null,
        shuffleHistory: [],
      });
      // The engine preloaded queue index 2 while the current track plays.
      usePlaybackStore.getState().setShuffleNextIndex(2);
      usePlaybackStore.getState().next(true);
      expect(usePlaybackStore.getState().currentIndex).toBe(2);
      expect(usePlaybackStore.getState().currentTrack?.id).toBe('c');
    }
  });

  it('clears the prepared index after it has been used', () => {
    usePlaybackStore.getState().setShuffleNextIndex(3);
    usePlaybackStore.getState().next(true);
    expect(usePlaybackStore.getState().shuffleNextIndex).toBeNull();
  });

  it('falls back to a random track when nothing was prepared', () => {
    usePlaybackStore.getState().next(true);
    const index = usePlaybackStore.getState().currentIndex;
    expect(index).not.toBe(0);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(4);
  });

  it('never plays the current track again when a stale prepared index is set', () => {
    usePlaybackStore.getState().setShuffleNextIndex(0);
    usePlaybackStore.getState().next(true);
    expect(usePlaybackStore.getState().currentIndex).not.toBe(0);
  });
});
