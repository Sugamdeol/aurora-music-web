import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { PlaylistCard, SongRow } from '../components/Media';
import { EmptyState, PageHeader, Pill } from '../components/primitives';
import { Icon } from '../components/Icon';
import { filterTracks, shuffledTracks, type TrackSort } from '../lib/collections';
import { db } from '../lib/db';
import { useDialog } from '../hooks/useDialog';
import type { MediaTrack } from '../domain/media';

type Tab = 'recent' | 'liked' | 'top' | 'albums' | 'artists' | 'playlists' | 'local';
const tabs: Array<[Tab, string]> = [['recent', 'Recent'], ['liked', 'Liked'], ['top', 'Top 50'], ['albums', 'Albums'], ['artists', 'Artists'], ['playlists', 'Playlists'], ['local', 'Local files']];
const tabValues = tabs.map(([value]) => value);

/** Albums and artists are derived from whatever the library already holds. */
function groupBy(tracks: MediaTrack[], key: 'album' | 'artist') {
  const groups = new Map<string, { name: string; id?: string; artwork?: string; tracks: MediaTrack[] }>();
  for (const track of tracks) {
    const name = key === 'album' ? track.album : track.artist;
    if (!name) continue;
    const existing = groups.get(name);
    if (existing) existing.tracks.push(track);
    else groups.set(name, { name, id: key === 'album' ? track.albumId : track.artistId, artwork: track.artwork, tracks: [track] });
  }
  return [...groups.values()].sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name));
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const initialTab = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(tabValues.includes(initialTab as Tab) ? initialTab! : 'recent');
  const parameterKey = params.toString();
  const [creating, setCreating] = useState(params.get('create') === '1');
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<TrackSort>('saved');
  const [createError, setCreateError] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recent = useLibraryStore((state) => state.recent);
  const liked = useLibraryStore((state) => state.likedTracks);
  const playlists = useLibraryStore((state) => state.playlists);
  const localTracks = useLibraryStore((state) => state.localTracks);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const importFiles = useLibraryStore((state) => state.importFiles);
  const [topTracks, setTopTracks] = useState<MediaTrack[]>([]);
  useEffect(() => {
    if (tab !== 'top') return;
    void db.tracks.toArray().then((rows) => setTopTracks(
      rows.filter((row) => (row.playCount ?? 0) > 0)
        .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
        .slice(0, 50) as MediaTrack[],
    ));
  }, [tab, recent]);
  /** Everything the library knows about, de-duplicated, for the derived tabs. */
  const allTracks = useMemo(() => {
    const unique = new Map<string, MediaTrack>();
    for (const track of [...recent, ...liked, ...localTracks, ...playlists.flatMap((playlist) => playlist.tracks)]) unique.set(track.id, track);
    return [...unique.values()];
  }, [recent, liked, localTracks, playlists]);
  const albums = useMemo(() => tab === 'albums' ? groupBy(allTracks, 'album') : [], [allTracks, tab]);
  const artists = useMemo(() => tab === 'artists' ? groupBy(allTracks, 'artist') : [], [allTracks, tab]);
  const term = filter.trim().toLocaleLowerCase();
  const visibleGroups = (tab === 'albums' ? albums : artists).filter((group) => !term || group.name.toLocaleLowerCase().includes(term));
  const isGroupTab = tab === 'albums' || tab === 'artists';
  const tracks = tab === 'liked' ? liked : tab === 'local' ? localTracks : tab === 'top' ? topTracks : recent;
  const visibleTracks = useMemo(() => filterTracks(tracks, filter, sort), [tracks, filter, sort]);
  const visiblePlaylists = useMemo(() => {
    const terms = filter.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const result = playlists.filter((playlist) => terms.every((term) => `${playlist.name} ${playlist.description ?? ''}`.toLocaleLowerCase().includes(term)));
    return result.sort(sort === 'title' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.updatedAt - a.updatedAt);
  }, [playlists, filter, sort]);
  const label = tab === 'liked' ? 'Liked songs' : tab === 'local' ? 'Local music' : tab === 'top' ? 'Top 50' : 'Recently played';

  useEffect(() => {
    if (params.get('create') === '1') setCreating(true);
    const requested = params.get('tab') as Tab | null;
    if (requested && tabValues.includes(requested) && requested !== tab) setTab(requested);
  }, [parameterKey]);
  const changeTab = (next: Tab) => {
    setTab(next);
    const updated = new URLSearchParams(params);
    updated.set('tab', next);
    updated.delete('create');
    setParams(updated, { replace: true });
  };
  const createDialogRef = useDialog<HTMLDivElement>(creating, () => setCreating(false));
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (createBusy) return;
    setCreateBusy(true); setCreateError('');
    try {
      await createPlaylist(name);
      setName(''); setCreating(false); setTab('playlists'); setFilter('');
      setParams({ tab: 'playlists' }, { replace: true });
    } catch (error) { setCreateError(error instanceof Error ? error.message : 'Could not create playlist. Try again.'); }
    finally { setCreateBusy(false); }
  };
  const onFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setImporting(true);
    try { await importFiles(files); setTab('local'); }
    finally { setImporting(false); event.target.value = ''; }
  };
  const playAll = (shuffle = false) => visibleTracks.length && usePlaybackStore.getState().playTracks(shuffle ? shuffledTracks(visibleTracks) : visibleTracks, 0, label);

  return <div className="page library-page">
    <PageHeader title="Your library" description="The songs, files, and playlists you have made your own." action={<div className="library-play-actions"><Link className="secondary-button" to="/ai"><Icon name="sparkles" size={17} /> AI playlist</Link><button className="primary-button" onClick={() => setCreating(true)}><Icon name="plus" size={17} /> New playlist</button></div>} />
    <div className="library-highlights">
      <button className="library-highlight liked-highlight" onClick={() => changeTab('liked')}><span><Icon name="heart" /></span><div><strong>Liked songs</strong><small>{liked.length} tracks you love</small></div><Icon name="chevron-right" /></button>
      <button className="library-highlight recent-highlight" onClick={() => changeTab('recent')}><span><Icon name="clock" /></span><div><strong>Recently played</strong><small>{recent.length} tracks in your history</small></div><Icon name="chevron-right" /></button>
    </div>
    <div className="pill-row library-tabs" role="group" aria-label="Library sections">{tabs.map(([value, label]) => <Pill key={value} selected={tab === value} onClick={() => changeTab(value)} aria-pressed={tab === value}>{label}</Pill>)}</div>

    <div className="library-toolbar glass-surface"><label className="library-filter"><Icon name="search" size={18} /><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={tab === 'playlists' ? 'Find a playlist' : 'Filter by song, artist, or album'} aria-label="Search your library" />{filter && <button onClick={() => setFilter('')} aria-label="Clear library search"><Icon name="x" size={16} /></button>}</label><label className="library-sort"><span>Sort by</span><select aria-label="Sort library" value={tab === 'playlists' && sort !== 'title' ? 'saved' : sort} onChange={(event) => setSort(event.target.value as TrackSort)}><option value="saved">{tab === 'playlists' ? 'Recently updated' : 'Default order'}</option><option value="title">{tab === 'playlists' ? 'Playlist name' : 'Song title'}</option>{tab !== 'playlists' && <><option value="artist">Artist</option><option value="duration">Duration</option></>}</select></label></div>

    <section className="library-content">
      {tab === 'playlists' && (visiblePlaylists.length ? <div className="media-grid">{visiblePlaylists.map((playlist) => <PlaylistCard key={playlist.id} id={playlist.id} title={playlist.name} artwork={playlist.artwork || playlist.tracks[0]?.artwork} count={playlist.tracks.length} />)}</div> : filter && playlists.length ? <EmptyState icon="search" title="No matching playlists" action={<button className="text-button" onClick={() => setFilter('')}>Clear search</button>}>Try a different playlist name.</EmptyState> : <EmptyState icon="disc" title="Make your first playlist" action={<button className="primary-button" onClick={() => setCreating(true)}>Create playlist</button>}>Collect tracks for a mood, a trip, or a day worth remembering.</EmptyState>)}
      {tab === 'local' && <div className="local-import-bar"><div><Icon name="folder" /><span><strong>On this device</strong><small>Audio stays in this browser.</small></span></div><button className="secondary-button" onClick={() => inputRef.current?.click()} disabled={importing}><Icon name="upload" size={16} /> {importing ? 'Importing…' : 'Add music'}</button><input ref={inputRef} hidden type="file" accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.webm" multiple onChange={onFiles} /></div>}
      {isGroupTab && (visibleGroups.length ? <div className="media-grid library-groups">{visibleGroups.map((group) => {
        const to = tab === 'albums' ? (group.id ? `/album/${encodeURIComponent(group.id)}` : '') : (group.id ? `/artist/${encodeURIComponent(group.id)}` : '');
        const count = `${group.tracks.length} ${group.tracks.length === 1 ? 'track' : 'tracks'}`;
        const body = <><span className="artwork library-group-art">{group.artwork ? <img src={group.artwork} alt="" loading="lazy" /> : <Icon name={tab === 'albums' ? 'disc' : 'users'} size={26} />}</span><strong>{group.name}</strong><small>{count}</small></>;
        return to
          ? <Link key={group.name} className={`library-group ${tab === 'artists' ? 'is-artist' : ''}`} to={to}>{body}</Link>
          : <button key={group.name} className={`library-group ${tab === 'artists' ? 'is-artist' : ''}`} onClick={() => usePlaybackStore.getState().playTracks(group.tracks, 0, group.name)}>{body}</button>;
      })}</div> : <EmptyState icon={tab === 'albums' ? 'disc' : 'users'} title={term ? `No matching ${tab}` : `No ${tab} yet`}>{term ? 'Try another name.' : 'Play or save some music and it will group here.'}</EmptyState>)}
      {!isGroupTab && tab !== 'playlists' && (visibleTracks.length ? <><div className="library-content-head"><span>{visibleTracks.length} {visibleTracks.length === 1 ? 'track' : 'tracks'}{filter ? ` of ${tracks.length}` : ''}</span><div className="library-play-actions"><button className="text-button" onClick={() => playAll(true)}><Icon name="shuffle" size={15} /> Shuffle</button><button className="secondary-button" onClick={() => playAll()}><Icon name="play" size={15} /> Play all</button></div></div><div className="song-list">{visibleTracks.map((track, index) => <SongRow key={track.id} track={track} context={visibleTracks} contextLabel={label} index={index} />)}</div></> : filter && tracks.length ? <EmptyState icon="search" title="No matching songs" action={<button className="text-button" onClick={() => setFilter('')}>Clear search</button>}>Try another song, artist, or album.</EmptyState> : <EmptyState icon={tab === 'liked' ? 'heart' : tab === 'local' ? 'folder' : tab === 'top' ? 'chart' : 'clock'} title={tab === 'liked' ? 'No liked songs yet' : tab === 'local' ? 'Bring your own music' : tab === 'top' ? 'No top songs yet' : 'Your listening starts here'}>{tab === 'liked' ? 'Tap the heart beside a song you want to keep.' : tab === 'local' ? 'Add audio files from this device to listen in Aurora.' : tab === 'top' ? 'Your 50 most-played songs will collect here as you listen.' : 'Songs you play will be waiting here when you come back.'}</EmptyState>)}
    </section>

    <p className="library-footnote">Your library is stored locally. <Link to="/history">Listening history</Link> · <Link to="/settings">Manage storage and backup</Link></p>
    {creating && <div className="modal-scrim" ref={createDialogRef} role="dialog" aria-modal="true" aria-labelledby="playlist-title" tabIndex={-1}><form className="modal-card glass-surface" onSubmit={create}><button type="button" className="modal-close" onClick={() => setCreating(false)} aria-label="Close"><Icon name="x" /></button><Icon name="disc" size={32} /><h2 id="playlist-title">Create a playlist</h2><p>Give this collection a name. You can add songs from any track menu.</p><label>Playlist name<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={64} placeholder="Late-night drive" required /></label>{createError && <p className="danger" role="alert">{createError}</p>}<div><button type="button" className="secondary-button" onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={createBusy || !name.trim()} type="submit">{createBusy ? 'Creating…' : 'Create playlist'}</button></div></form></div>}
  </div>;
}
