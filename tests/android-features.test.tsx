import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_PLAYBACK_SETTINGS, type MediaTrack } from '../src/domain/media';
import { db, getPlaybackSettings, getSetting, hydratePlaylists } from '../src/lib/db';
import { EQ_FREQUENCIES, EQ_PRESETS, EqualizerGraph, safeEqualizerGains } from '../src/lib/equalizer';
import { lyricIndexAt, songShareUrl, startTrackRadio } from '../src/lib/trackActions';
import { api } from '../src/lib/api';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import { PlayerOverlays } from '../src/components/Player';
import { HistoryPage } from '../src/pages/HistoryPage';

const songs: MediaTrack[] = ['one', 'two', 'three'].map((id) => ({ id, kind: 'song', source: 'remote', title: `Song ${id}`, artist: 'Test artist' }));
let client: QueryClient;
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([db.tracks.clear(), db.history.clear(), db.settings.clear(), db.playlists.clear(), db.playlistTracks.clear()]);
  usePlaybackStore.setState({ currentTrack: null, queue: [], currentIndex: -1, sourceRevision: 0, fullPlayerOpen: false, activeSheet: null, position: 0, isPlaying: false });
  useLibraryStore.setState({ playlists: [], recent: [], playbackSettings: { ...DEFAULT_PLAYBACK_SETTINGS }, likedIds: new Set() });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });
const page = (content: React.ReactNode) => render(<QueryClientProvider client={client}><MemoryRouter>{content}</MemoryRouter></QueryClientProvider>);

describe('equalizer audio path', () => {
  it('limits corrupt or out-of-range gains to five safe bands', () => {
    expect(safeEqualizerGains([50, -30, NaN, '8', 4, 20])).toEqual([12, -12, 0, 0, 4]);
    expect(safeEqualizerGains(null)).toEqual([0, 0, 0, 0, 0]);
  });
  it('connects five real filter nodes in sequence and leaves headroom for boosts', () => {
    const filters = EQ_FREQUENCIES.map(() => ({ type: '', frequency: { value: 0 }, Q: { value: 0 }, gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }));
    const gain = { gain: { setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    let index = 0;
    const context = { currentTime: 3, createBiquadFilter: () => filters[index++], createGain: () => gain } as unknown as AudioContext;
    const graph = new EqualizerGraph(context);
    const source = { connect: vi.fn() } as unknown as AudioNode;
    graph.update(EQ_PRESETS.Bass);
    expect(graph.connect(source)).toBe(gain);
    expect(source.connect).toHaveBeenCalledWith(filters[0]);
    filters.slice(0, -1).forEach((filter, i) => expect(filter.connect).toHaveBeenCalledWith(filters[i + 1]));
    expect(filters[4].connect).toHaveBeenCalledWith(gain);
    expect(filters.map((filter) => filter.frequency.value)).toEqual(EQ_FREQUENCIES);
    expect(filters[0].gain.setTargetAtTime).toHaveBeenCalledWith(6, 3, .03);
    expect(gain.gain.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(.501, 3);
  });
  it('persists the selected sound preset and enabled state', async () => {
    await useLibraryStore.getState().updatePlaybackSettings({ equalizerEnabled: true, equalizerGains: EQ_PRESETS.Vocals });
    expect(await getPlaybackSettings()).toMatchObject({ equalizerEnabled: true, equalizerGains: EQ_PRESETS.Vocals });
  });
});

describe('song radio and sharing', () => {
  it('starts a radio with the seed first and no repeated recommendations', async () => {
    vi.spyOn(api, 'related').mockResolvedValue([songs[0], songs[1], songs[1], songs[2]]);
    expect(await startTrackRadio(songs[0])).toBe(true);
    expect(usePlaybackStore.getState().queue.map((track) => track.id)).toEqual(['one', 'two', 'three']);
    expect(usePlaybackStore.getState().contextLabel).toBe('Song one radio');
    expect(usePlaybackStore.getState().autoplayEligible).toBe(false);
  });
  it('does not replace music selected while a radio request is pending', async () => {
    let resolve!: (tracks: MediaTrack[]) => void;
    vi.spyOn(api, 'related').mockImplementation(() => new Promise((done) => { resolve = done; }));
    const pending = startTrackRadio(songs[0]);
    usePlaybackStore.getState().playTracks([songs[2]], 0, 'Chosen song');
    resolve([songs[1]]);
    expect(await pending).toBe(false);
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('three');
  });
  it('does not disturb playback if the service has no radio results', async () => {
    usePlaybackStore.getState().playTracks([songs[2]], 0, 'Current');
    vi.spyOn(api, 'related').mockResolvedValue([]);
    await expect(startTrackRadio(songs[0])).rejects.toThrow('No radio suggestions');
    expect(usePlaybackStore.getState().currentTrack?.id).toBe('three');
  });
  it('shares a music link with the track ID safely encoded', () => {
    const url = new URL(songShareUrl({ ...songs[0], id: 'a&b?c' }));
    expect(url.origin).toBe('https://music.youtube.com');
    expect(url.searchParams.get('v')).toBe('a&b?c');
  });
});

describe('mobile queue tools', () => {
  it('finds a song in a long queue without changing its real queue index', () => {
    const queue = Array.from({ length: 8 }, (_, index) => ({ ...songs[index % songs.length], id: `song-${index}`, title: `Song ${index}` }));
    usePlaybackStore.setState({ queue, currentTrack: queue[0], currentIndex: 0, activeSheet: 'queue' });
    page(<PlayerOverlays />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find in queue' }), { target: { value: 'Song 6' } });
    expect(screen.getByText('Song 6')).toBeInTheDocument();
    expect(screen.queryByText('Song 5')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move Song 6 up' }));
    expect(usePlaybackStore.getState().queue[5].id).toBe('song-6');
  });
});

describe('lyric timing', () => {
  it('delays or advances the selected lyric by the chosen offset', () => {
    expect(lyricIndexAt([0, 5, 10], 5.1, 250)).toBe(0);
    expect(lyricIndexAt([0, 5, 10], 4.8, -250)).toBe(1);
    expect(lyricIndexAt([undefined, undefined], 20, 0)).toBe(-1);
  });
  it('saves timing for the current song and applies it when seeking a lyric', async () => {
    vi.spyOn(api, 'lyrics').mockResolvedValue({ synced: true, provider: 'Test', lines: [{ time: 5, text: 'First line' }, { time: 10, text: 'Second line' }] });
    usePlaybackStore.setState({ currentTrack: songs[0], duration: 100, fullPlayerOpen: true });
    page(<PlayerOverlays />);
    const later = await screen.findByRole('button', { name: 'Show lyrics 250 milliseconds later' });
    await waitFor(() => expect(later).toBeEnabled());
    fireEvent.click(later);
    await waitFor(async () => expect(await getSetting('lyrics.offset.one', 0)).toBe(250));
    fireEvent.click(screen.getByRole('button', { name: 'First line' }));
    expect(usePlaybackStore.getState().position).toBe(5.25);
    expect(await getSetting('lyrics.offset.two', 0)).toBe(0);
  });
});

describe('playlist editing', () => {
  it('persists details and a new track order without changing liked-track metadata', async () => {
    await db.tracks.put({ ...songs[0], likedAt: 123, playCount: 4 });
    const playlist = await useLibraryStore.getState().createPlaylistFromTracks('Original', songs);
    await useLibraryStore.getState().editPlaylist(playlist.id, ' Renamed ', ' A night drive ');
    await useLibraryStore.getState().reorderPlaylist(playlist.id, 2, 0);
    const saved = (await hydratePlaylists())[0];
    expect(saved).toMatchObject({ name: 'Renamed', description: 'A night drive' });
    expect(saved.tracks.map((track) => track.id)).toEqual(['three', 'one', 'two']);
    expect(await db.tracks.get('one')).toMatchObject({ likedAt: 123, playCount: 4 });
  });
  it('rejects blank names and ignores invalid ordering moves', async () => {
    const playlist = await useLibraryStore.getState().createPlaylistFromTracks('Original', songs);
    await expect(useLibraryStore.getState().editPlaylist(playlist.id, '  ', '')).rejects.toThrow('Enter a playlist name');
    await useLibraryStore.getState().reorderPlaylist(playlist.id, NaN, 0);
    expect((await hydratePlaylists())[0].tracks.map((track) => track.id)).toEqual(['one', 'two', 'three']);
  });
});

describe('detailed listening history', () => {
  it('keeps repeated visits separate, reports actual listening time, and replays an exact visit', async () => {
    await db.tracks.put(songs[0]);
    const now = Date.now();
    await db.history.bulkAdd([{ trackId: 'one', trackTitle: 'Song one', artist: 'Test artist', playedAt: now, listenedSeconds: 25 }, { trackId: 'one', trackTitle: 'Song one', artist: 'Test artist', playedAt: now - 1000, listenedSeconds: 35 }]);
    page(<HistoryPage />);
    const visits = await screen.findAllByRole('button', { name: 'Replay Song one' });
    expect(visits).toHaveLength(2);
    expect(screen.getByText('1:00')).toBeInTheDocument();
    fireEvent.click(visits[1]);
    expect(usePlaybackStore.getState()).toMatchObject({ currentIndex: 1, contextLabel: 'Listening history', autoplayEligible: false });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search listening history' }), { target: { value: 'does not exist' } });
    expect(screen.getByRole('heading', { name: 'No matching visits' })).toBeInTheDocument();
  });
});
