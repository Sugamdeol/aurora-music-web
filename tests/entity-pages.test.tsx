import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EntityDetail, MediaEntity, MediaTrack } from '../src/domain/media';
import { api } from '../src/lib/api';
import { db, getSetting } from '../src/lib/db';
import { LibraryPage } from '../src/pages/LibraryPage';
import { EntityPage } from '../src/pages/EntityPage';
import { useLibraryStore } from '../src/store/library';

const song = (id: string, title: string): MediaTrack => ({ id, kind: 'song', source: 'remote', title, artist: 'Sample Artist', durationSeconds: 180 });
let client: QueryClient;

beforeEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await Promise.all([db.tracks.clear(), db.history.clear(), db.playlists.clear(), db.playlistTracks.clear(), db.settings.clear()]);
  useLibraryStore.setState({ ready: true, likedIds: new Set(), likedTracks: [], recent: [], localTracks: [], playlists: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

function openPage(path: string, route: string, kind: EntityDetail['kind']) {
  const page = <EntityPage forcedKind={kind} />;
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={page} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe('collection pages', () => {
  it('shows an artist popular list once and keeps albums in their own shelf', async () => {
    const tracks = Array.from({ length: 12 }, (_, index) => song(`track-${index}`, `Popular ${index + 1}`));
    const album: MediaEntity = { id: 'album-1', browseId: 'album-1', kind: 'album', title: 'Moonrise', subtitle: '2025 · Album' };
    vi.spyOn(api, 'entity').mockResolvedValue({
      kind: 'artist', id: 'artist-1', title: 'Sample Artist', sections: [
        { id: 'popular', title: 'Popular tracks', items: tracks },
        { id: 'albums', title: 'Albums', items: [album] },
      ], tracks,
    });

    const { container } = openPage('/artist/artist-1', '/artist/:id', 'artist');
    expect(await screen.findByRole('heading', { name: 'Sample Artist' })).toBeInTheDocument();
    expect(container.querySelectorAll('.entity-tracks .song-row')).toHaveLength(10);
    expect(screen.getByRole('link', { name: /Moonrise/ })).toHaveAttribute('href', '/album/album-1');
    expect(screen.queryByRole('button', { name: 'Popular 11' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }));
    await screen.findByRole('button', { name: 'Following' });
    await waitFor(async () => expect(await getSetting<MediaEntity[]>('library.following.artists', [])).toEqual([
      expect.objectContaining({ id: 'artist-1', title: 'Sample Artist', kind: 'artist' }),
    ]));
  });

  it('saves a remote playlist as a local playlist and links to the copy', async () => {
    const tracks = [song('song-1', 'First Song'), song('song-2', 'Second Song')];
    vi.spyOn(api, 'entity').mockResolvedValue({
      kind: 'playlist', id: 'remote-list', title: 'Road Home', subtitle: 'Shared by Aurora',
      sections: [{ id: 'track-list', title: 'Track list', items: tracks }], tracks,
    });

    openPage('/playlist/remote/remote-list', '/playlist/remote/:id', 'playlist');
    fireEvent.click(await screen.findByRole('button', { name: 'Save to Your Library' }));
    expect(await screen.findByText('Playlist saved to your library.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open saved playlist' })).toHaveAttribute('href', expect.stringContaining('/playlist/local/'));
    expect(useLibraryStore.getState().playlists[0]).toMatchObject({ name: 'Road Home', tracks });
  });

  it('shows followed artists in the library even before any of their songs are saved', async () => {
    await db.settings.put({ key: 'library.following.artists', value: [{ id: 'artist-1', browseId: 'artist-1', kind: 'artist', title: 'Sample Artist' }], updatedAt: Date.now() });
    render(<MemoryRouter initialEntries={['/library?tab=artists']}><LibraryPage /></MemoryRouter>);
    expect(await screen.findByRole('link', { name: /Sample Artist/ })).toHaveAttribute('href', '/artist/artist-1');
  });
});
