import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { MediaTrack } from '../src/domain/media';
import { api } from '../src/lib/api';
import { db, hydratePlaylists } from '../src/lib/db';
import { dailyMix } from '../src/lib/homeMix';
import { HomePage } from '../src/pages/HomePage';
import { useLibraryStore } from '../src/store/library';
import { usePlaybackStore } from '../src/store/playback';
import { useRoomStore } from '../src/room/client';
import { useYouTubeAccountStore } from '../src/store/youtubeAccount';

const favorites: MediaTrack[] = ['a', 'b', 'c'].map((id) => ({ id, kind: 'song', source: 'remote', title: `Favorite ${id}`, artist: `Artist ${id}`, durationSeconds: 180 }));
const discoveries: MediaTrack[] = ['d', 'e', 'f'].map((id) => ({ id, kind: 'song', source: 'remote', title: `Discovery ${id}`, artist: `Artist ${id}` }));
let client: QueryClient;

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([db.tracks.clear(), db.history.clear(), db.playlists.clear(), db.playlistTracks.clear()]);
  useLibraryStore.setState({ ready: true, likedIds: new Set(), likedTracks: [], recent: [], localTracks: [], playlists: [] });
  usePlaybackStore.setState({ currentTrack: null, queue: [], currentIndex: -1, position: 0, isPlaying: false, fullPlayerOpen: false, activeSheet: null });
  useRoomStore.setState({ username: 'Sugam' });
  useYouTubeAccountStore.setState({ likedTracks: [], connected: false });
  vi.spyOn(api, 'home').mockResolvedValue([]);
  vi.spyOn(api, 'search').mockResolvedValue([]);
  vi.spyOn(api, 'related').mockResolvedValue([]);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

function openHome() {
  return render(<QueryClientProvider client={client}><MemoryRouter><HomePage /></MemoryRouter></QueryClientProvider>);
}

describe('daily mix selection', () => {
  it('rotates familiar songs and interleaves new discoveries without repeating tracks', () => {
    const result = dailyMix([...favorites, favorites[0]], [favorites[0], ...discoveries, discoveries[0]], 1);
    expect(result.map((track) => track.id)).toEqual(['b', 'd', 'e', 'c', 'f', 'a']);
    expect(favorites.map((track) => track.id)).toEqual(['a', 'b', 'c']);
  });
  it('supports both a new listener and an offline library', () => {
    expect(dailyMix([], discoveries, 0)).toEqual(discoveries);
    expect(dailyMix(favorites, [], 0)).toEqual(favorites);
    expect(dailyMix([], [], 0)).toEqual([]);
  });
  it('keeps the mix to twenty songs', () => {
    const songs = Array.from({ length: 35 }, (_, index) => ({ ...favorites[0], id: String(index) }));
    expect(dailyMix(songs, [], 0)).toHaveLength(20);
  });
});

describe('expanded home', () => {
  it('greets the listener and offers moods even before any music has been played', async () => {
    openHome();
    expect(screen.getByText(/Good (morning|afternoon|evening), Sugam/)).toBeInTheDocument();
    for (const mood of ['Slow mornings', 'Deep focus', 'After hours', 'Move', 'Rainy days', 'Feel good']) {
      expect(screen.getByRole('link', { name: new RegExp(mood) })).toHaveAttribute('href', expect.stringContaining('/search?q='));
    }
    expect(await screen.findByRole('heading', { name: 'Your listening starts here' })).toBeInTheDocument();
  });

  it('plays the whole personal mix with discoveries as a collection queue', async () => {
    useLibraryStore.setState({ likedTracks: favorites, likedIds: new Set(favorites.map((track) => track.id)) });
    vi.mocked(api.related).mockResolvedValue(discoveries);
    openHome();
    await screen.findByRole('heading', { name: 'New sounds for you' });
    await screen.findByRole('button', { name: 'Play discoveries' });
    fireEvent.click(screen.getByRole('button', { name: 'Play mix' }));
    const state = usePlaybackStore.getState();
    expect(state.contextLabel).toBe('Daily Mix');
    expect(state.autoplayEligible).toBe(false);
    expect(state.queue).toHaveLength(6);
    expect(new Set(state.queue.map((track) => track.id)).size).toBe(6);
  });

  it('saves the displayed daily mix to the actual library', async () => {
    useLibraryStore.setState({ likedTracks: favorites, likedIds: new Set(favorites.map((track) => track.id)) });
    openHome();
    fireEvent.click(screen.getByRole('button', { name: 'Save mix' }));
    expect(await screen.findByRole('link', { name: 'Open saved mix' }, { timeout: 5000 })).toHaveAttribute('href', expect.stringContaining('/playlist/local/'));
    const saved = await hydratePlaylists();
    expect(saved).toHaveLength(1);
    expect(saved[0].tracks).toHaveLength(3);
    expect(saved[0].name).toMatch(/^Daily Mix/);
  });

  it('shows recorded listening minutes and play counts instead of demo data', async () => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    await db.tracks.bulkPut([{ ...favorites[0], playCount: 7 }, { ...favorites[1], playCount: 2 }]);
    await db.history.bulkAdd([
      { trackId: 'a', playedAt: today.getTime() + 1000, listenedSeconds: 90 },
      { trackId: 'b', playedAt: today.getTime() + 2000, listenedSeconds: 35 },
      { trackId: 'c', playedAt: today.getTime() - 1000, listenedSeconds: 600 },
    ]);
    openHome();
    await screen.findByText('7 plays');
    const summary = screen.getByRole('heading', { name: 'Your listening today' }).closest('section')!;
    expect(within(summary).getByText('minutes listened').previousElementSibling).toHaveTextContent('2');
    expect(within(summary).getByText('songs started').previousElementSibling).toHaveTextContent('2');
    expect(within(summary).getByRole('link', { name: 'Artist a' })).toBeInTheDocument();
  });

  it('controls the existing player without replacing its queue or playback position', () => {
    usePlaybackStore.setState({ currentTrack: favorites[0], queue: favorites, currentIndex: 0, position: 77, isPlaying: true });
    openHome();
    const card = screen.getByRole('region', { name: 'Pick up your music' });
    fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));
    expect(usePlaybackStore.getState()).toMatchObject({ isPlaying: false, position: 77, queue: favorites });
    fireEvent.click(within(card).getByRole('button', { name: 'Open player' }));
    expect(usePlaybackStore.getState().fullPlayerOpen).toBe(true);
  });

  it('keeps favorites playable when online discovery fails', async () => {
    useLibraryStore.setState({ likedTracks: favorites, likedIds: new Set(favorites.map((track) => track.id)) });
    vi.mocked(api.home).mockRejectedValue(new Error('Offline'));
    openHome();
    await screen.findByRole('heading', { name: 'Discovery is taking a moment' }, { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'Play mix' }));
    expect(usePlaybackStore.getState().queue).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Always a favorite' })).toBeInTheDocument();
  });
});
