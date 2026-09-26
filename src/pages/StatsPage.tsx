import { useEffect, useMemo, useState } from 'react';
import type { HistoryRecord, TrackRecord } from '../lib/db';
import { db } from '../lib/db';
import { PageHeader, Pill } from '../components/primitives';
import { Artwork } from '../components/primitives';
import { Icon } from '../components/Icon';

type Range = 7 | 30 | 0;
interface ListeningData { history: HistoryRecord[]; tracks: TrackRecord[] }

export function StatsPage() {
  const [range, setRange] = useState<Range>(7);
  const [data, setData] = useState<ListeningData>({ history: [], tracks: [] });
  const [tableOpen, setTableOpen] = useState(false);
  useEffect(() => {
    const refresh = () => { void Promise.all([db.history.orderBy('playedAt').toArray(), db.tracks.toArray()]).then(([history, tracks]) => setData({ history, tracks })); };
    refresh();
    const timer = window.setInterval(refresh, 6000);
    return () => window.clearInterval(timer);
  }, []);
  const cutoff = useMemo(() => {
    if (!range) return 0;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (range - 1));
    return start.getTime();
  }, [range]);
  const history = useMemo(() => data.history.filter((item) => item.playedAt >= cutoff), [data.history, cutoff]);
  const trackMap = useMemo(() => new Map(data.tracks.map((track) => [track.id, track])), [data.tracks]);
  const playCounts = useMemo(() => {
    if (!range) return new Map(data.tracks.filter((track) => (track.playCount ?? 0) > 0).map((track) => [track.id, track.playCount ?? 0]));
    const counts = new Map<string, number>();
    history.forEach((item) => counts.set(item.trackId, (counts.get(item.trackId) ?? 0) + 1));
    return counts;
  }, [data.tracks, history, range]);
  const unique = playCounts.size;
  const artists = range
    ? new Set(history.map((item) => item.artist || trackMap.get(item.trackId)?.artist).filter(Boolean)).size
    : new Set(data.tracks.filter((track) => (track.playCount ?? 0) > 0).map((track) => track.artist).filter(Boolean)).size;
  const totalPlays = range ? history.length : [...playCounts.values()].reduce((sum, count) => sum + count, 0);
  const measuredSeconds = history.reduce((total, item) => total + (item.listenedSeconds ?? 0), 0);
  const measuredTime = measuredSeconds >= 3600
    ? `${Math.floor(measuredSeconds / 3600)}h ${Math.floor((measuredSeconds % 3600) / 60)}m`
    : measuredSeconds >= 60
      ? `${Math.floor(measuredSeconds / 60)}m ${measuredSeconds % 60}s`
      : `${measuredSeconds}s`;
  const dayCount = range || 30;
  const days = useMemo(() => Array.from({ length: dayCount }, (_, offset) => {
    const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (dayCount - 1 - offset));
    const end = date.getTime() + 86_400_000;
    const count = history.filter((item) => item.playedAt >= date.getTime() && item.playedAt < end).length;
    return { key: date.toISOString().slice(0, 10), label: date.toLocaleDateString(undefined, { weekday: 'short' }), short: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), full: date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }), count };
  }), [history, dayCount]);
  const maxDay = Math.max(1, ...days.map((day) => day.count));
  const topTracks = useMemo(() => {
    return [...playCounts].sort((a, b) => b[1] - a[1]).slice(0, 8).flatMap(([id, count]) => {
      const played = history.find((item) => item.trackId === id);
      const track = trackMap.get(id) ?? (played?.trackTitle ? { id, title: played.trackTitle, artist: played.artist ?? 'Unknown artist', artwork: played.artwork } as TrackRecord : undefined);
      return track ? [{ track, count }] : [];
    });
  }, [history, playCounts, trackMap]);
  const topArtists = useMemo(() => {
    const counts = new Map<string, number>();
    if (range) history.forEach((item) => { const artist = item.artist || trackMap.get(item.trackId)?.artist; if (artist) counts.set(artist, (counts.get(artist) || 0) + 1); });
    else data.tracks.forEach((track) => { if (track.artist && track.playCount) counts.set(track.artist, (counts.get(track.artist) || 0) + track.playCount); });
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data.tracks, history, range, trackMap]);
  const maxArtist = Math.max(1, ...topArtists.map(([, count]) => count));

  return <div className="page stats-page">
    <PageHeader title="Listening stats" description="A private view of what has been playing in this browser." />
    <div className="stats-filter pill-row" aria-label="Stats date range">{([[7, '7 days'], [30, '30 days'], [0, 'All time']] as Array<[Range, string]>).map(([value, label]) => <Pill key={value} selected={range === value} onClick={() => setRange(value)}>{label}</Pill>)}</div>
    <section className="hero-stat"><span>Plays in this period</span><strong>{totalPlays.toLocaleString()}</strong><p>{totalPlays ? `${unique} unique tracks from ${artists} ${artists === 1 ? 'artist' : 'artists'}` : 'Play a song and your listening story will begin here.'}</p></section>
    <div className="stat-tiles"><StatTile label="Measured listening" value={measuredTime} icon="clock" /><StatTile label="Unique tracks" value={unique.toLocaleString()} icon="music" /><StatTile label="Artists heard" value={artists.toLocaleString()} icon="users" /></div>

    <section className="chart-card">
      <header><div><h2>{range ? 'Daily plays' : 'Recent 30 days'}</h2><p>Number of tracks started each day</p></div><button className="text-button" onClick={() => setTableOpen((open) => !open)}>{tableOpen ? 'Show chart' : 'Show table'}</button></header>
      {tableOpen ? <div className="chart-table-wrap"><table><thead><tr><th>Date</th><th>Plays</th></tr></thead><tbody>{days.map((day) => <tr key={day.key}><td>{day.full}</td><td>{day.count}</td></tr>)}</tbody></table></div>
        : <figure className="daily-chart" aria-label="Daily plays column chart"><div className="chart-grid" aria-hidden="true">{[maxDay, Math.round(maxDay / 2), 0].map((value, tick) => <i key={tick} data-value={value} />)}</div><div className="chart-columns">{days.map((day, index) => <button key={day.key} className={`chart-column ${day.count === maxDay && day.count > 0 ? 'is-peak' : ''}`} title={`${day.full}: ${day.count} plays`} aria-label={`${day.full}: ${day.count} plays`}><span style={{ height: `${Math.max(day.count ? 7 : 1, (day.count / maxDay) * 100)}%` }} data-value={day.count} /><small>{dayCount <= 7 ? day.label : index % 5 === 0 ? day.short : ''}</small></button>)}</div><figcaption>Each bar shows tracks started on that day. Focus a bar for its exact value.</figcaption></figure>}
    </section>

    <div className="stats-grid">
      <section className="chart-card top-tracks"><header><div><h2>Most played</h2><p>Tracks started most often</p></div></header>{topTracks.length ? <ol>{topTracks.map(({ track, count }, index) => <li key={track.id}><span>{index + 1}</span><Artwork src={track.artwork} title={track.title} /><div><strong>{track.title}</strong><small>{track.artist}</small></div><em>{count} {count === 1 ? 'play' : 'plays'}</em></li>)}</ol> : <p className="chart-empty">No listening data for this period.</p>}</section>
      <section className="chart-card artist-bars"><header><div><h2>Top artists</h2><p>Plays grouped by artist</p></div></header>{topArtists.length ? <div>{topArtists.map(([artist, count]) => <div key={artist}><span><strong>{artist}</strong><small>{count}</small></span><button title={`${artist}: ${count} plays`} aria-label={`${artist}: ${count} plays`}><i style={{ width: `${(count / maxArtist) * 100}%` }} /></button></div>)}</div> : <p className="chart-empty">No artist data for this period.</p>}</section>
    </div>
    <p className="stats-note"><Icon name="library" size={15} /> Track starts and listening time are counted locally. Listening time is measured during playback; older sessions have no time measurement.</p>
  </div>;
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: 'clock' | 'music' | 'users' }) { return <div className="stat-tile"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></div>; }
