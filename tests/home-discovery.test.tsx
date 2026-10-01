import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { HomeDiscovery } from '../src/components/HomeDiscovery';
import { api } from '../src/lib/api';
import { usePlaybackStore } from '../src/store/playback';
import type { MediaTrack } from '../src/domain/media';

const tracks: MediaTrack[] = ['one', 'two'].map((id) => ({ id, title: `Song ${id}`, kind: 'song', source: 'remote', artist: 'Karan Aujla' }));
let client: QueryClient;
let observers: Array<{ callback: IntersectionObserverCallback; target?: Element }>;
beforeEach(() => {
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    entry: { callback: IntersectionObserverCallback; target?: Element };
    constructor(callback: IntersectionObserverCallback) { this.entry = { callback }; observers.push(this.entry); }
    observe(target: Element) { this.entry.target = target; }
    disconnect() {}
  });
  vi.spyOn(api, 'search').mockResolvedValue(tracks);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  usePlaybackStore.setState({ currentTrack: null, queue: [], currentIndex: -1, position: 0, isPlaying: false, fullPlayerOpen: false });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const open = () => render(<QueryClientProvider client={client}><MemoryRouter><HomeDiscovery /></MemoryRouter></QueryClientProvider>);
function reveal(name: string) {
  const region = screen.getByRole('region', { name });
  const observer = observers.find((item) => item.target === region)!;
  act(() => observer.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  return region;
}

describe('home discovery shelves', () => {
  it('waits for a shelf to enter the viewport and plays it with the correct queue context', async () => {
    open();
    expect(api.search).not.toHaveBeenCalled();
    const region = reveal("It's Karan Aujla season");
    const play = await within(region).findByRole('button', { name: 'Play all' });
    fireEvent.click(play);
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(usePlaybackStore.getState().queue).toEqual(tracks);
    expect(usePlaybackStore.getState().contextLabel).toBe("It's Karan Aujla season");
    expect(screen.getByRole('heading', { name: 'Live performances' })).toBeInTheDocument();
  });
  it('opens albums and playlists as typed searches', () => {
    open();
    expect(within(screen.getByRole('region', { name: 'Albums for you' })).getByRole('link', { name: 'More' })).toHaveAttribute('href', '/search?q=Karan%20Aujla&type=album');
    expect(within(screen.getByRole('region', { name: 'From the community' })).getByRole('link', { name: 'More' })).toHaveAttribute('href', expect.stringContaining('type=playlist'));
  });
  it('keeps a failed shelf retryable while the other shelves remain available', async () => {
    vi.mocked(api.search).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(tracks);
    open();
    const region = reveal('Quick picks');
    fireEvent.click(await within(region).findByRole('button', { name: 'Try again' }));
    expect(await within(region).findByRole('button', { name: 'Play all' })).toBeInTheDocument();
    expect(within(region).getAllByRole('button', { name: /Play Song/ })).toHaveLength(2);
  });
});
