import { describe, expect, it } from 'vitest';
import { buildTasteProfile, rankRecommendations } from '../src/lib/recommendations';
import { usePlaybackStore } from '../src/store/playback';
import { useRecommendationStore } from '../src/store/recommendations';
import type { MediaTrack } from '../src/domain/media';
const track = (id: string, artist = 'Artist A', title = id): MediaTrack => ({ id, artist, title, kind: 'song', source: 'remote' });
const feedback = { hidden: [], skips: {} };

describe('personal recommendations', () => {
  it('weights engaged recent listens above short plays and old listens', () => {
    const now = 100 * 86_400_000;
    const profile = buildTasteProfile([], [
      { trackId: 'full', artist: 'Artist A', playedAt: now, listenedSeconds: 180 },
      { trackId: 'short', artist: 'Artist B', playedAt: now, listenedSeconds: 5 },
      { trackId: 'old', artist: 'Artist C', playedAt: 0, listenedSeconds: 180 },
    ], now);
    expect(profile.artists['artist a']).toBeGreaterThan(profile.artists['artist b']);
    expect(profile.artists['artist a']).toBeGreaterThan(profile.artists['artist c']);
    expect(rankRecommendations([track('b', 'Artist B'), track('a')], profile, feedback)[0].id).toBe('a');
  });
  it('removes hidden songs, queue songs, local files and alternate uploads', () => {
    const candidates = [track('hidden'), track('queue'), track('one', 'Artist A', 'Hello (Official Audio)'), track('two', 'Artist A', 'Hello [Lyrics]'), { ...track('local'), source: 'local' as const }];
    expect(rankRecommendations(candidates, buildTasteProfile([], []), { hidden: ['hidden'], skips: {} }, { exclude: [track('queue')] }).map((item) => item.id)).toEqual(['one']);
  });
  it('breaks artist streaks while retaining preferred music', () => {
    const profile = buildTasteProfile([track('liked')], []);
    const ranked = rankRecommendations([track('a1'), track('a2'), track('a3'), track('b', 'Artist B')], profile, feedback);
    expect(ranked[0].artist).toBe('Artist A');
    expect(ranked.slice(0, 3).some((item) => item.artist === 'Artist B')).toBe(true);
  });
  it('lowers repeatedly skipped songs without permanently hiding them', () => {
    const ranked = rankRecommendations([track('skip'), track('good')], buildTasteProfile([], []), { hidden: [], skips: { skip: 3 } });
    expect(ranked.map((item) => item.id)).toEqual(['good', 'skip']);
  });
  it('counts a manual early skip but not autoplay or a loading failure', () => {
    useRecommendationStore.setState({ hidden: [], skips: {} });
    const queue = [track('one'), track('two')];
    const setup = (status: 'playing' | 'loading') => usePlaybackStore.setState({ queue, currentTrack: queue[0], currentIndex: 0, position: 10, duration: 200, status, shuffle: false, repeat: 'off' });
    setup('playing'); usePlaybackStore.getState().next(true);
    setup('loading'); usePlaybackStore.getState().next();
    expect(useRecommendationStore.getState().skips.one).toBeUndefined();
    setup('playing'); usePlaybackStore.getState().next();
    expect(useRecommendationStore.getState().skips.one).toBe(1);
    useRecommendationStore.setState({ hidden: [], skips: {} });
  });
  it('allows a hidden song again and caps skip weight', () => {
    useRecommendationStore.setState({ hidden: [], skips: {} });
    useRecommendationStore.getState().toggleHidden('song');
    expect(useRecommendationStore.getState().hidden).toEqual(['song']);
    useRecommendationStore.getState().toggleHidden('song');
    expect(useRecommendationStore.getState().hidden).toEqual([]);
    for (let i = 0; i < 8; i++) useRecommendationStore.getState().recordSkip('song');
    expect(useRecommendationStore.getState().skips.song).toBe(4);
    useRecommendationStore.setState({ hidden: [], skips: {} });
  });
});
