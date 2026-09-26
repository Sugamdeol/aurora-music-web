import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import { formatDuration, type MediaTrack } from '../domain/media';
import { usePlaybackStore } from '../store/playback';
import { useLibraryStore } from '../store/library';
import { Artwork, EmptyState, ErrorState, PageHeader, Pill, Skeleton } from '../components/primitives';
import { Icon } from '../components/Icon';

type Period = 'today' | 'week' | 'all';
export function HistoryPage() {
  const recent = useLibraryStore((state) => state.recent);
  const [period, setPeriod] = useState<Period>('week');
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(80);
  const data = useQuery({ queryKey: ['listening-history', recent], staleTime: 5000, refetchInterval: 15_000, queryFn: async () => {
    const [visits, tracks] = await Promise.all([db.history.orderBy('playedAt').reverse().toArray(), db.tracks.toArray()]);
    const map = new Map(tracks.map((track) => [track.id, track]));
    return visits.map((visit) => ({ ...visit, track: map.get(visit.trackId) }));
  } });
  const entries = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (period === 'week') start.setDate(start.getDate() - 6);
    const cutoff = period === 'all' ? 0 : start.getTime();
    const terms = filter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return (data.data ?? []).filter((entry) => entry.playedAt >= cutoff && terms.every((term) => `${entry.trackTitle ?? entry.track?.title ?? ''} ${entry.artist ?? entry.track?.artist ?? ''}`.toLocaleLowerCase().includes(term)));
  }, [data.data, period, filter]);
  const playable = entries.filter((entry): entry is typeof entry & { track: MediaTrack } => Boolean(entry.track));
  const tracks = playable.map((entry) => entry.track);
  const totalSeconds = entries.reduce((sum, entry) => sum + (entry.listenedSeconds ?? 0), 0);
  const groups = new Map<string, typeof entries>();
  entries.slice(0, limit).forEach((entry) => {
    const day = new Date(entry.playedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    groups.set(day, [...(groups.get(day) ?? []), entry]);
  });
  const replay = (id?: number) => { const index = playable.findIndex((entry) => entry.id === id); if (index >= 0) usePlaybackStore.getState().playTracks(tracks, index, 'Listening history'); };
  return <div className="page history-page">
    <PageHeader title="Listening history" description="Every visit to a song, with the time you actually spent listening." action={<Link to="/stats" className="secondary-button"><Icon name="chart" size={17} /> Listening stats</Link>} />
    <div className="history-controls"><div className="pill-row" aria-label="History period">{([['today', 'Today'], ['week', '7 days'], ['all', 'All time']] as Array<[Period, string]>).map(([value, label]) => <Pill key={value} selected={period === value} onClick={() => { setPeriod(value); setLimit(80); }}>{label}</Pill>)}</div><label className="history-search"><Icon name="search" size={18} /><input value={filter} onChange={(event) => { setFilter(event.target.value); setLimit(80); }} placeholder="Find a song or artist" aria-label="Search listening history" /></label></div>
    {data.isLoading ? <Skeleton className="entity-hero-skeleton" /> : data.isError ? <ErrorState message="Your listening history could not be opened." retry={() => void data.refetch()} /> : <>
      <div className="history-summary glass-surface"><div><strong>{entries.length}</strong><span>songs started</span></div><div><strong>{formatDuration(totalSeconds)}</strong><span>recorded listening</span></div>{tracks.length > 0 && <button className="primary-button" onClick={() => usePlaybackStore.getState().playTracks(tracks, 0, 'Listening history')}><Icon name="play" size={16} /> Play these songs</button>}</div>
      {entries.length ? [...groups].map(([day, visits]) => <section key={day} className="history-day"><h2>{day}</h2>{visits.map((entry) => <article key={entry.id} className="history-visit"><Artwork src={entry.artwork ?? entry.track?.artwork} title={entry.trackTitle ?? entry.track?.title} /><div><strong>{entry.trackTitle ?? entry.track?.title ?? 'Unavailable track'}</strong><span>{entry.artist ?? entry.track?.artist ?? 'Unknown artist'}</span><small>{new Date(entry.playedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {formatDuration(entry.listenedSeconds ?? 0)} listened</small></div><button className="icon-button" disabled={!entry.track} onClick={() => replay(entry.id)} aria-label={`Replay ${entry.trackTitle ?? entry.track?.title ?? 'track'}`}><Icon name="play" size={18} /></button></article>)}</section>) : <EmptyState icon="clock" title={filter ? 'No matching visits' : 'Your story starts with a song'}>{filter ? 'Try another song title or artist.' : 'Play music and your recorded listening will appear here.'}</EmptyState>}
      {entries.length > limit && <button className="secondary-button history-load-more" onClick={() => setLimit((value) => value + 80)}>Show more · {entries.length - limit} remaining</button>}
    </>}
  </div>;
}
