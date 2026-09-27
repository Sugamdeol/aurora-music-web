import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDuration, type MediaTrack } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { useRoomStore } from '../room/client';
import { MediaCard, PlaylistCard, SongRow } from '../components/Media';
import { Artwork, EmptyState, ErrorState, Section, Skeleton } from '../components/primitives';
import { Icon, type IconName } from '../components/Icon';
import { db } from '../lib/db';
import { useYouTubeAccountStore } from '../store/youtubeAccount';
import { dailyMix, uniqueTracks } from '../lib/homeMix';
import './HomePage.css';

const moods: Array<{ title: string; query: string; description: string; icon: IconName; tone: string }> = [
  { title: 'Slow mornings', query: 'slow morning acoustic music', description: 'Ease into the day', icon: 'sun', tone: '#dfb47d' },
  { title: 'Deep focus', query: 'instrumental focus music', description: 'Space to think', icon: 'music', tone: '#8cbcc7' },
  { title: 'After hours', query: 'late night r&b music', description: 'Warm bass, low lights', icon: 'moon', tone: '#c89bb4' },
  { title: 'Move', query: 'upbeat workout music', description: 'Find your momentum', icon: 'sparkles', tone: '#b5cf81' },
  { title: 'Rainy days', query: 'rainy day indie music', description: 'Stay a little longer', icon: 'lyrics', tone: '#9daecc' },
  { title: 'Feel good', query: 'feel good pop music', description: 'Turn the day around', icon: 'heart', tone: '#d6a18b' },
];

function CurrentSongCard({ recent }: { recent: MediaTrack[] }) {
  const current = usePlaybackStore((state) => state.currentTrack);
  const playing = usePlaybackStore((state) => state.isPlaying);
  const position = usePlaybackStore((state) => state.position);
  const track = current ?? recent[0];
  return <section className="home-resume glass-surface" aria-label="Pick up your music">
    <div className="home-card-kicker"><span className={current && playing ? 'home-live-dot is-playing' : 'home-live-dot'} />{current ? 'On your player' : 'Last played'}</div>
    {track ? <><Artwork src={track.artwork} title={track.title} className="home-resume-art" /><div className="home-resume-copy"><h2>{track.title}</h2><p>{track.artist}</p>{current && position > 0 && <small>{formatDuration(position)} into this track</small>}</div><div className="home-resume-actions"><button className="secondary-button" onClick={() => current ? usePlaybackStore.getState().togglePlayback() : usePlaybackStore.getState().playTrack(track, recent, 'Recently played')}><Icon name={current && playing ? 'pause' : 'play'} size={16} />{current && playing ? 'Pause' : 'Play'}</button>{current && <button className="text-button" onClick={() => usePlaybackStore.getState().openFullPlayer(true)}>Open player <Icon name="chevron-right" size={15} /></button>}</div></> : <div className="home-resume-empty"><Icon name="disc" size={46} /><h2>A new favorite awaits.</h2><p>Find that first song. We’ll keep your listening close.</p><Link to="/search" className="secondary-button">Find music <Icon name="search" size={16} /></Link></div>}
  </section>;
}

export function HomePage() {
  const recent = useLibraryStore((state) => state.recent);
  const liked = useLibraryStore((state) => state.likedTracks);
  const localCount = useLibraryStore((state) => state.localTracks.length);
  const playlists = useLibraryStore((state) => state.playlists);
  const ready = useLibraryStore((state) => state.ready);
  const username = useRoomStore((state) => state.username);
  const youtubeLikes = useYouTubeAccountStore((state) => state.likedTracks);
  const youtubeConnected = useYouTubeAccountStore((state) => state.connected);
  const [saveState, setSaveState] = useState<{ signature: string; id?: string; error?: string; busy?: boolean }>({ signature: '' });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = today.getTime();
  const dateKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = username && username !== 'Listener' ? username : '';

  const library = useQuery({
    queryKey: ['home-library', dayStart, recent, liked.length, localCount], enabled: ready, staleTime: 30_000, refetchInterval: 60_000, retry: false,
    queryFn: async () => {
      const [records, history] = await Promise.all([db.tracks.toArray(), db.history.where('playedAt').aboveOrEqual(dayStart).toArray()]);
      const topTracks = records.filter((track) => (track.playCount ?? 0) > 0).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0));
      const artists = new Map<string, { name: string; artwork?: string; plays: number }>();
      for (const track of topTracks.filter((item) => item.source !== 'local')) {
        const key = track.artist.trim().toLocaleLowerCase();
        if (!key) continue;
        const existing = artists.get(key);
        artists.set(key, { name: existing?.name ?? track.artist, artwork: existing?.artwork ?? track.artwork, plays: (existing?.plays ?? 0) + (track.playCount ?? 0) });
      }
      return { topTracks: topTracks.slice(0, 8), artists: [...artists.values()].sort((a, b) => b.plays - a.plays).slice(0, 5), todaySeconds: history.reduce((sum, entry) => sum + (entry.listenedSeconds ?? 0), 0), todayPlays: history.length };
    },
  });
  const tasteSeeds = useMemo(() => uniqueTracks([...youtubeLikes.slice(0, 3), ...liked.slice(0, 2), ...(library.data?.topTracks ?? []), ...recent]).filter((track) => track.source !== 'local').slice(0, 5).map((track) => track.id), [youtubeLikes, liked, library.data?.topTracks, recent]);
  const personal = useQuery({
    queryKey: ['made-for-you', tasteSeeds], enabled: tasteSeeds.length > 0, staleTime: 10 * 60_000, retry: 1,
    queryFn: async ({ signal }) => {
      const results = await Promise.allSettled(tasteSeeds.map((id) => api.related(id, signal)));
      if (results.every((result) => result.status === 'rejected')) throw new Error('Your discoveries could not be reached. Your saved music is still here.');
      const seen = new Set([...recent, ...liked, ...youtubeLikes].map((track) => track.id));
      return uniqueTracks(results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])).filter((track) => !seen.has(track.id)).slice(0, 24);
    },
  });
  const discovery = useQuery({ queryKey: ['home'], queryFn: ({ signal }) => api.home(signal), staleTime: 5 * 60_000, retry: 1 });
  const discoveryTracks = useMemo(() => discovery.data?.flatMap((section) => section.items).filter((item): item is MediaTrack => 'source' in item) ?? [], [discovery.data]);
  const familiar = useMemo(() => uniqueTracks([...liked, ...recent, ...(library.data?.topTracks ?? []), ...youtubeLikes]).slice(0, 20), [liked, recent, library.data?.topTracks, youtubeLikes]);
  const mix = useMemo(() => dailyMix(familiar, personal.data?.length ? personal.data : discoveryTracks, Math.floor(dayStart / 86_400_000)), [familiar, personal.data, discoveryTracks, dayStart]);
  useEffect(() => {
    const first = mix[0];
    if (!first || first.source !== 'remote') return;
    const timer = window.setTimeout(() => {
      void api.warmStream(first, useLibraryStore.getState().playbackSettings.preferredQuality).catch(() => undefined);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [mix]);
  const signature = `${dateKey}:${mix.map((track) => track.id).join(',')}`;
  const saved = saveState.signature === signature ? saveState : undefined;
  const play = (tracks: MediaTrack[], label: string) => { if (tracks.length) usePlaybackStore.getState().playTracks(tracks, 0, label); };
  const saveMix = async () => {
    if (!mix.length || saveState.busy) return;
    setSaveState({ signature, busy: true });
    try {
      const playlist = await useLibraryStore.getState().createPlaylistFromTracks(`Daily Mix · ${today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`, mix);
      setSaveState({ signature, id: playlist.id });
    } catch (error) { setSaveState({ signature, error: error instanceof Error ? error.message : 'Could not save your mix. Try again.' }); }
  };
  const refresh = () => { void discovery.refetch(); void library.refetch(); if (tasteSeeds.length) void personal.refetch(); };
  const refreshing = discovery.isFetching || personal.isFetching || library.isFetching;

  return <div className="page home-page home-expanded">
    <header className="home-welcome"><div><span>{hello}{name ? `, ${name}` : ''}</span><h1>Your music. Your moment.</h1><p>A familiar sound, a new favorite, and somewhere to begin.</p></div><button className="home-refresh secondary-button" disabled={refreshing} onClick={refresh}><Icon name="repeat" size={16} /><span>{refreshing ? 'Updating…' : 'Refresh'}</span></button></header>
    <div className="home-feature-grid">
      <section className="home-daily-mix glass-surface" aria-labelledby="daily-mix-heading">
        <div className="home-mix-copy"><span className="home-card-kicker"><Icon name="sparkles" size={14} />{name ? `Made for ${name}` : 'A little more you'}</span><h2 id="daily-mix-heading">Your<br />Daily Mix.</h2><p>{mix.length ? 'Favorites and fresh finds, woven together for today.' : 'Find a song or like a favorite. Your mix grows with your listening.'}</p><div className="home-mix-actions">{mix.length ? <><button className="primary-button" onClick={() => play(mix, 'Daily Mix')}><Icon name="play" size={17} /> Play mix</button>{saved?.id ? <Link className="secondary-button" to={`/playlist/local/${encodeURIComponent(saved.id)}`}>Open saved mix</Link> : <button className="secondary-button" disabled={saveState.busy} onClick={() => void saveMix()}><Icon name="plus" size={16} />{saveState.busy ? 'Saving…' : 'Save mix'}</button>}</> : <Link className="primary-button" to="/search">Discover music <Icon name="search" size={16} /></Link>}</div><small>{mix.length ? `${mix.length} songs · Refreshed daily` : 'Your music, at your own pace'}</small>{saved?.error && <p className="home-mix-error danger" role="alert">{saved.error}</p>}</div>
        <div className="home-mix-art" aria-hidden="true">{mix.length ? Array.from({ length: 4 }, (_, index) => <Artwork key={index} src={mix[index % mix.length].artwork} title={mix[index % mix.length].title} />) : <div className="home-mix-symbol"><img src="/aurora.svg" alt="" /><span>AURORA / DAILY</span></div>}</div>
      </section>
      <CurrentSongCard recent={recent} />
    </div>
    <nav className="home-shortcuts" aria-label="Your music shortcuts">
      <Link to="/library?tab=liked"><span className="home-shortcut-icon"><Icon name="heart" /></span><span><strong>Liked songs</strong><small>{liked.length} favorites</small></span><Icon name="chevron-right" size={16} /></Link>
      <Link to="/library?tab=playlists"><span className="home-shortcut-icon"><Icon name="disc" /></span><span><strong>Your playlists</strong><small>{playlists.length} collections</small></span><Icon name="chevron-right" size={16} /></Link>
      <Link to="/library?tab=local"><span className="home-shortcut-icon"><Icon name="folder" /></span><span><strong>On this device</strong><small>{localCount} local songs</small></span><Icon name="chevron-right" size={16} /></Link>
      <Link to="/room"><span className="home-shortcut-icon"><Icon name="users" /></span><span><strong>Listen together</strong><small>Make it a shared moment</small></span><Icon name="chevron-right" size={16} /></Link>
    </nav>
    <Section title="Continue listening" action={recent.length ? <button className="text-button" onClick={() => play(recent, 'Recently played')}>Play all <Icon name="play" size={14} /></button> : <Link className="text-button" to="/search">Find music</Link>}>
      {!ready ? <div className="horizontal-shelf">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="continue-skeleton" />)}</div> : recent.length ? <div className="horizontal-shelf continue-shelf">{recent.slice(0, 8).map((track) => <MediaCard key={track.id} item={track} context={recent} contextLabel="Recently played" />)}</div> : <EmptyState icon="music" title="Your listening starts here" action={<Link className="secondary-button" to="/search">Find a song</Link>}>Play something you love. It will be waiting here when you come back.</EmptyState>}
    </Section>
    <Section title="Find your mood" className="home-moods"><div className="home-mood-grid">{moods.map((mood) => <Link key={mood.title} to={`/search?q=${encodeURIComponent(mood.query)}`} className="home-mood-card" style={{ '--mood-tone': mood.tone } as React.CSSProperties}><Icon name={mood.icon} size={24} /><strong>{mood.title}</strong><span>{mood.description}</span><Icon name="chevron-right" size={16} /></Link>)}</div></Section>
    {(personal.isLoading || Boolean(personal.data?.length) || personal.isError) && <Section title="New sounds for you" className="personal-section" action={personal.data?.length ? <button className="text-button" onClick={() => play(personal.data!, 'New sounds for you')}>Play discoveries <Icon name="play" size={14} /></button> : undefined}><p className="taste-note">{youtubeConnected ? 'Inspired by your YouTube Music likes and listening' : 'Inspired by your favorites and the songs you return to'}</p>{personal.isLoading ? <div className="horizontal-shelf">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="media-skeleton" />)}</div> : personal.data?.length ? <div className="horizontal-shelf">{personal.data.slice(0, 12).map((track) => <MediaCard key={track.id} item={track} context={personal.data} contextLabel="New sounds for you" />)}</div> : personal.isError ? <ErrorState message="We couldn’t reach your discoveries. Try again in a moment." retry={() => void personal.refetch()} /> : null}</Section>}
    {liked.length > 0 && <Section title="Always a favorite" action={<Link className="text-button" to="/library?tab=liked">All favorites <Icon name="chevron-right" size={14} /></Link>}><div className="horizontal-shelf">{liked.slice(0, 8).map((track) => <MediaCard key={track.id} item={track} context={liked} contextLabel="Liked songs" />)}</div></Section>}
    <div className="home-listening-grid">
      <section className="home-heavy-rotation glass-surface"><header className="section-header"><div><span className="home-card-kicker">The songs you come back to</span><h2>In heavy rotation</h2></div>{Boolean(library.data?.topTracks.length) && <button className="text-button" onClick={() => play(library.data!.topTracks, 'Heavy rotation')}>Play all <Icon name="play" size={14} /></button>}</header>{library.data?.topTracks.length ? <div className="home-rotation-list">{library.data.topTracks.slice(0, 4).map((track, index) => <div key={track.id}><SongRow track={track} context={library.data!.topTracks} contextLabel="Heavy rotation" index={index} /><small>{track.playCount} {track.playCount === 1 ? 'play' : 'plays'}</small></div>)}</div> : <div className="home-rotation-empty"><Icon name="repeat" size={28} /><p>{library.isError ? 'Your listening history could not be opened.' : 'Your repeat favorites will find a home here.'}</p>{library.isError && <button className="text-button" onClick={() => void library.refetch()}>Try again</button>}</div>}</section>
      <section className="home-listening-card glass-surface"><span className="home-card-kicker">A moment for your music</span><h2>Your listening today</h2><div className="home-listening-numbers"><div><strong>{library.data ? Math.floor(library.data.todaySeconds / 60) : '—'}</strong><span>minutes listened</span></div><div><strong>{library.data?.todayPlays ?? '—'}</strong><span>songs started</span></div></div>{Boolean(library.data?.artists.length) && <div className="home-top-artists"><span>Your most-played artists</span>{library.data!.artists.slice(0, 3).map((artist) => <Link key={artist.name} aria-label={artist.name} to={`/search?q=${encodeURIComponent(artist.name)}`}><Artwork src={artist.artwork} title={artist.name} rounded /><strong>{artist.name}</strong><Icon name="chevron-right" size={14} /></Link>)}</div>}<Link className="text-button" to="/stats">See your listening story <Icon name="chevron-right" size={15} /></Link></section>
    </div>
    <Section title="Your playlists" action={<Link className="text-button" to="/library?create=1">New playlist <Icon name="plus" size={14} /></Link>}>
      {playlists.length ? <div className="horizontal-shelf">{playlists.slice(0, 10).map((playlist) => <PlaylistCard key={playlist.id} id={playlist.id} title={playlist.name} artwork={playlist.artwork || playlist.tracks[0]?.artwork} count={playlist.tracks.length} />)}</div> : <div className="playlist-invite"><span><Icon name="disc" /></span><div><h3>A soundtrack for every side of you.</h3><p>Collect songs for a drive, a quiet hour, or whatever comes next.</p></div><Link className="secondary-button" to="/library?create=1">Create playlist</Link></div>}
    </Section>
    {discovery.isLoading && <Section title="Exploring new sounds"><div className="horizontal-shelf">{[1, 2, 3, 4, 5].map((item) => <Skeleton key={item} className="media-skeleton" />)}</div></Section>}
    {discovery.isError && <ErrorState title="Discovery is taking a moment" message="Online music could not be loaded. Your saved favorites and local music are still available." retry={() => void discovery.refetch()} />}
    {discovery.data?.slice(0, 5).map((section) => { const tracks = section.items.filter((item): item is MediaTrack => 'source' in item); return <Section key={section.id} title={section.title}><div className="horizontal-shelf">{section.items.slice(0, 10).map((item, index) => <MediaCard key={`${item.id}-${index}`} item={item} context={tracks} contextLabel={section.title} />)}</div></Section>; })}
    <section className="home-explore-footer"><span>Keep following the sound.</span><div>{['Punjabi', 'Hindi', 'R&B', 'Indie', 'K-pop', 'Jazz'].map((genre) => <Link key={genre} to={`/search?q=${encodeURIComponent(`${genre} music`)}`}>{genre}<Icon name="chevron-right" size={13} /></Link>)}</div></section>
  </div>;
}
