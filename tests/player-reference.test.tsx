import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PlayerOverlays } from '../src/components/Player';
import { api } from '../src/lib/api';
import { usePlaybackStore } from '../src/store/playback';
import { useLibraryStore } from '../src/store/library';
import type { MediaTrack } from '../src/domain/media';

const track: MediaTrack = { id: 'player-test', kind: 'song', source: 'remote', title: 'Test song', artist: 'Test artist' };
let client: QueryClient;
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.spyOn(api, 'lyrics').mockResolvedValue({ lines: [{ time: 0, text: 'First line' }, { time: 30, text: 'Next line' }], provider: 'Test lyrics', synced: true });
  usePlaybackStore.setState({ currentTrack: track, queue: [track], currentIndex: 0, position: 12, duration: 180, volume: .7, isPlaying: true, status: 'playing', fullPlayerOpen: true, activeSheet: null });
  useLibraryStore.setState({ likedIds: new Set(), likedTracks: [], playlists: [] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); });

it('keeps the reference player controls and nested queue connected to the shared player', async () => {
  render(<QueryClientProvider client={client}><MemoryRouter><PlayerOverlays /></MemoryRouter></QueryClientProvider>);
  const player = screen.getByRole('dialog', { name: 'Now playing Test song' });
  expect(player).toHaveClass('reference-player');
  expect(within(player).getByText('Options').closest('details')).not.toHaveAttribute('open');
  fireEvent.change(within(player).getByRole('slider', { name: 'Volume' }), { target: { value: '0.35' } });
  expect(usePlaybackStore.getState().volume).toBe(.35);
  fireEvent.click(within(player).getByRole('button', { name: 'Pause' }));
  expect(usePlaybackStore.getState().isPlaying).toBe(false);
  fireEvent.click(await within(player).findByRole('button', { name: 'Next line' }));
  expect(usePlaybackStore.getState().position).toBe(30);
  fireEvent.click(within(player).getByRole('button', { name: 'Open playback queue' }));
  expect(screen.getByRole('dialog', { name: 'Playback queue' })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(usePlaybackStore.getState().activeSheet).toBeNull();
  expect(usePlaybackStore.getState().fullPlayerOpen).toBe(true);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(usePlaybackStore.getState().fullPlayerOpen).toBe(false);
});
