import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { isTrack, type MediaEntity, type MediaSection, type MediaTrack } from '../domain/media';
import { api } from '../lib/api';
import { uniqueTracks } from '../lib/homeMix';
import { usePlaybackStore } from '../store/playback';
import { MediaCard, SongRow } from './Media';
import { Icon } from './Icon';
import { Artwork, IconButton, Skeleton } from './primitives';
import './HomeDiscovery.css';
import { buildTasteProfile, rankRecommendations } from '../lib/recommendations';
import { useRecommendationStore } from '../store/recommendations';

type SearchKind = 'song' | 'video' | 'album' | 'playlist';
interface Shelf {
  id: string;
  title: string;
  query: string;
  kind: SearchKind;
  rows?: boolean;
  artist?: string;
}

export function homeShelves(artists: string[]): Shelf[] {
  const personal = artists.filter((artist) => artist.trim() && artist.toLowerCase() !== 'unknown artist');
  const names = [...new Set(personal.length ? [...personal, ...personal, ...personal, ...personal] : ['Karan Aujla', 'Ikky', 'Gur Sidhu', 'AP Dhillon'])];
  while (names.length < 4) names.push(names[names.length % Math.max(1, personal.length)] ?? names[0]);
  const sound = personal.length ? personal.slice(0, 2).join(' ') : 'Punjabi Hindi';
  const shelves: Shelf[] = [
    { id: 'new-releases', title: 'New releases', query: `new ${sound} albums`, kind: 'album' },
    { id: 'artist-season', title: `It's ${names[0]} season`, query: names[0], kind: 'song', artist: names[0] },
    { id: 'quick-picks', title: 'Quick picks', query: `${sound} songs`, kind: 'song', rows: true },
    { id: 'artist-two', title: names[1], query: names[1], kind: 'song', artist: names[1] },
    { id: 'artist-three', title: names[2], query: names[2], kind: 'song', artist: names[2] },
    { id: 'albums', title: 'Albums for you', query: names[0], kind: 'album' },
    { id: 'artist-four', title: names[3], query: names[3], kind: 'song', artist: names[3] },
    { id: 'indian-pop', title: 'Indian pop', query: 'Indian pop music', kind: 'video' },
    { id: 'community', title: 'From the community', query: `${sound} mix`, kind: 'playlist' },
    { id: 'trending-songs', title: 'Trending songs for you', query: `${sound} popular songs`, kind: 'song', rows: true },
    { id: 'covers', title: 'Covers and remixes', query: `${names[0]} covers remixes`, kind: 'song', rows: true },
    { id: 'fresh-finds', title: 'Fresh finds, old favourites', query: `${sound} classics mix`, kind: 'playlist' },
    { id: 'community-trending', title: 'Trending community playlists', query: `${sound} playlists`, kind: 'playlist' },
    { id: 'long-listens', title: 'Long listens', query: `${sound} jukebox`, kind: 'video', rows: true },
    { id: 'shorts', title: 'Heard in Shorts', query: 'viral shorts songs India', kind: 'song', rows: true },
    { id: 'daily-discover', title: 'Your daily discover', query: `new ${sound} music`, kind: 'video' },
    { id: 'shows', title: 'Shows for you', query: 'Indian music interviews podcasts', kind: 'video' },
    { id: 'videos', title: 'Music videos for you', query: `${names[0]} official music video`, kind: 'video' },
    { id: 'live', title: 'Live performances', query: `${names[0]} live performance`, kind: 'video' },
  ];
  const seenArtists = new Set<string>();
  return shelves.filter((shelf) => {
    if (!shelf.artist) return true;
    const key = shelf.artist.toLocaleLowerCase();
    if (seenArtists.has(key)) return false;
    seenArtists.add(key); return true;
  });
}

function DiscoveryShelf({ shelf, seeds, catalog }: { shelf: Shelf; seeds: MediaTrack[]; catalog: MediaSection[] }) {
  const feedback = useRecommendationStore();
  const host = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });
  useEffect(() => {
    if (visible || !host.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '180px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [visible]);
  const existing = catalog.find((section) => section.title.toLocaleLowerCase() === shelf.title.toLocaleLowerCase());
  const query = useQuery({
    queryKey: ['search', shelf.query, shelf.kind],
    queryFn: ({ signal }) => api.search(shelf.query, shelf.kind, signal),
    enabled: visible && !existing?.items.length && !(shelf.id === 'quick-picks' && seeds.filter((track) => !feedback.hidden.includes(track.id)).length >= 8),
    staleTime: 30 * 60_000,
    retry: false,
  });
  const items = useMemo(() => {
    const results = existing?.items.length ? existing.items : query.data ?? [];
    const values = shelf.id === 'quick-picks' ? rankRecommendations([...seeds, ...results.filter(isTrack)], buildTasteProfile(seeds, []), feedback, { limit: 8 }) : results.filter((item) => !isTrack(item) || !feedback.hidden.includes(item.id));
    return [...new Map(values.map((item) => [`${item.kind}:${item.id}`, item])).values()].slice(0, shelf.rows ? 8 : 12);
  }, [existing, query.data, seeds, shelf, feedback]);
  const tracks = items.filter(isTrack);
  const artwork = shelf.artist ? items.find((item) => isTrack(item) && item.artist.toLowerCase().includes(shelf.artist!.toLowerCase()))?.artwork : undefined;
  const updateScroll = () => {
    const element = scroller.current;
    if (element) setCanScroll({ back: element.scrollLeft > 4, forward: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
  };
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    updateScroll();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateScroll);
    observer.observe(element);
    return () => observer.disconnect();
  }, [items]);
  const scroll = (direction: number) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * .85, behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
  return <section ref={host} className={`content-section discovery-shelf ${shelf.rows ? 'discovery-shelf-rows' : ''} ${shelf.kind === 'video' ? 'discovery-shelf-video' : ''}`} aria-label={shelf.title}>
    <header className="section-header">
      <div className="discovery-heading">{shelf.artist && <Artwork src={artwork} title={shelf.artist} rounded />}<div>{shelf.artist && <span>On repeat</span>}<h2>{shelf.title}</h2></div></div>
      <div className="discovery-actions">
        {tracks.length > 0 && <button className="discovery-play" onClick={() => usePlaybackStore.getState().playTracks(tracks, 0, shelf.title)}><Icon name="play" size={14} />Play all</button>}
        <Link className="discovery-more" to={`/search?q=${encodeURIComponent(shelf.query)}&type=${shelf.kind}`}>More</Link>
        {!shelf.rows && <><IconButton icon="chevron-right" label={`Scroll ${shelf.title} left`} className="discovery-back" disabled={!canScroll.back} onClick={() => scroll(-1)} /><IconButton icon="chevron-right" label={`Scroll ${shelf.title} right`} disabled={!canScroll.forward} onClick={() => scroll(1)} /></>}
      </div>
    </header>
    {items.length > 0 ? shelf.rows ? <div className="discovery-track-grid">{tracks.map((track, index) => <SongRow key={track.id} track={track} context={tracks} contextLabel={shelf.title} index={index} />)}</div> : <div ref={scroller} className={`horizontal-shelf discovery-cards ${shelf.kind === 'video' ? 'discovery-video-cards' : ''}`} onScroll={updateScroll}>{items.map((item: MediaEntity | MediaTrack) => <MediaCard key={`${item.kind}-${item.id}`} item={item} context={tracks} contextLabel={shelf.title} />)}</div> : query.isError ? <div className="discovery-status" role="status"><Icon name="wifi" size={22} /><span>This section couldn’t load.</span><button className="text-button" onClick={() => void query.refetch()}>Try again</button></div> : visible && !query.isFetching ? <div className="discovery-status"><span>No results for this section yet.</span><Link className="text-button" to={`/search?q=${encodeURIComponent(shelf.query)}&type=${shelf.kind}`}>Explore music</Link></div> : <div className={shelf.rows ? 'discovery-track-grid' : 'horizontal-shelf discovery-cards'} aria-busy="true" aria-label={`Loading ${shelf.title}`}>{Array.from({ length: shelf.rows ? 8 : 6 }, (_, index) => <Skeleton key={index} className={shelf.rows ? 'discovery-row-skeleton' : 'media-skeleton'} />)}</div>}
  </section>;
}

export function HomeDiscovery({ artists = [], seeds = [], catalog = [], section }: { artists?: string[]; seeds?: MediaTrack[]; catalog?: MediaSection[]; section?: 'quick-picks' | 'remaining' }) {
  const shelves = useMemo(() => homeShelves(artists).filter((shelf) => section === 'quick-picks' ? shelf.id === 'quick-picks' : section === 'remaining' ? shelf.id !== 'quick-picks' : true), [artists, section]);
  return <div className="home-discovery">{shelves.map((shelf) => <DiscoveryShelf key={shelf.id} shelf={shelf} seeds={seeds} catalog={catalog} />)}</div>;
}

