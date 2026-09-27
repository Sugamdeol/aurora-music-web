import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { MediaTrack } from '../src/domain/media';
import { db, getSetting, hydratePlaylists } from '../src/lib/db';
import { playbackEngine } from '../src/lib/playbackEngine';
import { filterTracks, shuffledTracks } from '../src/lib/collections';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import { PlayerDock } from '../src/components/Player';
import { LibraryPage } from '../src/pages/LibraryPage';

const tracks: MediaTrack[] = [
  { id: 'first', kind: 'song', source: 'remote', title: 'Northern Lights', artist: 'Aurora', album: 'Night Drive', durationSeconds: 240 },
  { id: 'second', kind: 'song', source: 'remote', title: 'After Hours', artist: 'The Weeknd', durationSeconds: 180 },
  { id: 'third', kind: 'song', source: 'remote', title: 'Blue', artist: 'Aurora' },
];

beforeEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  usePlaybackStore.setState({ queue: [], currentIndex: -1, currentTrack: null, position: 0, duration: 0, isPlaying: false, sourceRevision: 0, autoplayEligible: false, fullPlayerOpen: false, activeSheet: null, playbackRate: 1 });
  useLibraryStore.setState({ likedIds: new Set(), likedTracks: [], recent: [], localTracks: [], playlists: [] });
  await Promise.all([db.tracks.clear(), db.playlists.clear(), db.playlistTracks.clear()]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('library discovery', () => {
  it('matches all words across artist, album, and title without changing the library order', () => {
    expect(filterTracks(tracks, ' AURORA drive ', 'saved').map((track) => track.id)).toEqual(['first']);
    expect(filterTracks(tracks, '', 'title').map((track) => track.id)).toEqual(['second', 'third', 'first']);
    expect(filterTracks(tracks, '', 'duration').map((track) => track.id)).toEqual(['second', 'first', 'third']);
    expect(tracks.map((track) => track.id)).toEqual(['first', 'second', 'third']);
  });

  it('shuffles a copy while preserving every queue entry, including duplicates', () => {
    const source = [...tracks, tracks[0]];
    const shuffled = shuffledTracks(source);
    expect(shuffled).not.toBe(source);
    expect(shuffled.map((track) => track.id).sort()).toEqual(source.map((track) => track.id).sort());
    expect(source).toEqual([...tracks, tracks[0]]);
  });

  it('plays only matching library tracks after a search', () => {
    useLibraryStore.setState({ likedTracks: tracks, likedIds: new Set(tracks.map((track) => track.id)) });
    render(<MemoryRouter initialEntries={['/library?tab=liked']}><LibraryPage /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search your library' }), { target: { value: 'aurora' } });
    expect(screen.queryByText('After Hours')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play all' }));
    expect(usePlaybackStore.getState().queue.map((track) => track.id)).toEqual(['first', 'third']);
    expect(usePlaybackStore.getState().autoplayEligible).toBe(false);
  });
});

describe('player controls', () => {
  it.each(['play', 'togglePlayback'] as const)('reloads a failed source when %s is used', (action) => {
    usePlaybackStore.getState().playTrack(tracks[0]);
    usePlaybackStore.setState({ status: 'error', isPlaying: false, position: 42, error: 'Stream failed' });
    const revision = usePlaybackStore.getState().sourceRevision;
    usePlaybackStore.getState()[action]();
    expect(usePlaybackStore.getState()).toMatchObject({ sourceRevision: revision + 1, isPlaying: true, status: 'loading', position: 42, error: undefined });
  });
  it('applies playback speed to the audio element and saves the preference', async () => {
    const stop = playbackEngine.start();
    try {
      usePlaybackStore.getState().setPlaybackRate(1.25);
      expect(playbackEngine.audio.playbackRate).toBe(1.25);
      await vi.waitFor(async () => expect(await getSetting('player.speed', 1)).toBe(1.25));
      usePlaybackStore.getState().setPlaybackRate(NaN);
      expect(playbackEngine.audio.playbackRate).toBe(1.25);
    } finally { stop(); }
  });
  it('clears upcoming tracks without restarting or pausing the current song', () => {
    const player = usePlaybackStore.getState();
    player.playTracks(tracks, 1, 'An album');
    usePlaybackStore.setState({ position: 42, status: 'playing', autoplayEligible: true });
    const revision = usePlaybackStore.getState().sourceRevision;
    player.clearUpcoming();
    expect(usePlaybackStore.getState()).toMatchObject({ queue: tracks.slice(0, 2), currentTrack: tracks[1], currentIndex: 1, position: 42, isPlaying: true, status: 'playing', sourceRevision: revision, autoplayEligible: false });
  });

  it('keeps ten-second seeks inside the track and ignores invalid values', () => {
    usePlaybackStore.setState({ duration: 180, position: 175 });
    usePlaybackStore.getState().seek(185);
    expect(usePlaybackStore.getState().position).toBe(180);
    usePlaybackStore.getState().seek(-10);
    expect(usePlaybackStore.getState().position).toBe(0);
    usePlaybackStore.getState().seek(NaN);
    expect(usePlaybackStore.getState().position).toBe(0);
  });

  it('renders one seek control in the mini-player and lets it update the track', () => {
    usePlaybackStore.setState({ currentTrack: tracks[0], duration: 240, position: 60 });
    const { container } = render(<PlayerDock />);
    expect(screen.getAllByRole('slider', { name: 'Track progress' })).toHaveLength(1);
    expect(container.querySelectorAll('.dock-timeline')).toHaveLength(1);
    expect(container.querySelector('.dock-timeline')).not.toHaveClass('mini-progress-rail');
    fireEvent.change(screen.getByRole('slider', { name: 'Track progress' }), { target: { value: '90' } });
    expect(usePlaybackStore.getState().position).toBe(90);
  });
});

describe('queue playlists', () => {
  it('persists a queue with unique ordered songs while retaining likes and play counts', async () => {
    await db.tracks.put({ ...tracks[0], likedAt: 12345, playCount: 7 });
    const playlist = await useLibraryStore.getState().createPlaylistFromTracks(' Night drive ', [tracks[0], tracks[1], tracks[0]]);
    expect(playlist.name).toBe('Night drive');
    expect((await hydratePlaylists())[0].tracks.map((track) => track.id)).toEqual(['first', 'second']);
    expect(await db.tracks.get('first')).toMatchObject({ likedAt: 12345, playCount: 7 });
    expect(useLibraryStore.getState().playlists[0].id).toBe(playlist.id);
  });

  it('rolls back the whole playlist when storage fails', async () => {
    vi.spyOn(db.playlistTracks, 'bulkAdd').mockRejectedValueOnce(new Error('Storage full'));
    await expect(useLibraryStore.getState().createPlaylistFromTracks('Queue', tracks)).rejects.toThrow('Storage full');
    expect(await db.playlists.count()).toBe(0);
    expect(await db.tracks.count()).toBe(0);
    expect(useLibraryStore.getState().playlists).toHaveLength(0);
  });
});
