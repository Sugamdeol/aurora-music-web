import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EntityDetail, MediaSection, MediaTrack } from '../domain/media';
import { formatDuration, parseDuration } from '../domain/media';
import { api } from '../lib/api';
import { isEntitySaved, setEntitySaved } from '../lib/entityLibrary';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { MediaCard, SongRow } from '../components/Media';
import { Artwork, EmptyState, ErrorState, Skeleton } from '../components/primitives';
import { Icon } from '../components/Icon';
import { shuffledTracks } from '../lib/collections';
import { PlaylistEditor } from '../components/PlaylistEditor';

const isTrack = (item: MediaSection['items'][number]): item is MediaTrack => 'source' in item;

function primarySectionIndex(detail: EntityDetail): number {
  const trackSections = detail.sections
    .map((section, index) => ({ section, index, hasTracks: section.items.some(isTrack) }))
    .filter((item) => item.hasTracks);
  if (detail.kind === 'artist') {
    const popular = trackSections.find(({ section }) => /popular|top songs|top tracks/i.test(section.title));
    if (popular) return popular.index;
  }
  const list = trackSections.find(({ section }) => /track list|songs|tracks/i.test(section.title));
  return list?.index ?? trackSections[0]?.index ?? -1;
}

function trackDuration(tracks: MediaTrack[]): number {
  return tracks.reduce((total, track) => total + (track.durationSeconds ?? parseDuration(track.durationLabel) ?? 0), 0);
}

function trackWord(count: number): string {
  return `${count} ${count === 1 ? 'song' : 'songs'}`;
}

function metaValue(detail: EntityDetail, count: number, seconds: number): string[] {
  const values: string[] = [];
  if (detail.kind === 'album') {
    const artist = detail.artist || detail.subtitle?.split(/[•·|]/)[0]?.trim();
    if (artist) values.push(artist);
    if (detail.year) values.push(detail.year);
    values.push(trackWord(count));
    if (seconds > 0) values.push(formatDuration(seconds));
    return values;
  }
  if (detail.kind === 'artist') {
    if (detail.subtitle) values.push(detail.subtitle);
    if (!values.length && count) values.push(`${count} popular ${count === 1 ? 'song' : 'songs'}`);
    return values;
  }
  values.push(trackWord(count));
  if (seconds > 0) values.push(formatDuration(seconds));
  return values;
}

export function EntityPage({ forcedKind, local: isLocal = false }: { forcedKind?: EntityDetail['kind']; local?: boolean } = {}) {
  const { kind: rawKind, id: rawId } = useParams();
  const navigate = useNavigate();
  const kind = forcedKind ?? (['album', 'artist', 'playlist'].includes(rawKind || '') ? rawKind as EntityDetail['kind'] : 'playlist');
  const decodedId = decodeURIComponent(rawId || '');
  const id = isLocal && decodedId && !decodedId.startsWith('local:') ? `local:${decodedId}` : decodedId;
  const localId = id.startsWith('local:') ? id.slice(6) : '';
  const playlists = useLibraryStore((state) => state.playlists);
  const localPlaylist = localId ? playlists.find((playlist) => playlist.id === localId) : undefined;
  const deletePlaylist = useLibraryStore((state) => state.deletePlaylist);
  const createPlaylistFromTracks = useLibraryStore((state) => state.createPlaylistFromTracks);
  const [editing, setEditing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedPlaylistId, setSavedPlaylistId] = useState('');
  const query = useQuery({ queryKey: ['entity', kind, id], queryFn: ({ signal }) => api.entity(kind, id, signal), enabled: Boolean(id) && !localId, staleTime: 5 * 60_000, retry: 1 });

  const detail = useMemo<EntityDetail | undefined>(() => localPlaylist ? {
    kind: 'playlist', id: localPlaylist.id, title: localPlaylist.name, description: localPlaylist.description,
    artwork: localPlaylist.artwork || localPlaylist.tracks[0]?.artwork,
    sections: [], tracks: localPlaylist.tracks,
  } : query.data, [localPlaylist, query.data]);
  const sectionIndex = detail ? primarySectionIndex(detail) : -1;
  const primaryTracks = useMemo(() => {
    if (!detail) return [];
    if (localId || sectionIndex < 0) return detail.tracks;
    const section = detail.sections[sectionIndex];
    const sectionTracks = section?.items.filter(isTrack) ?? [];
    if (detail.kind === 'artist') return sectionTracks.slice(0, 10);
    return sectionTracks.length ? sectionTracks : detail.tracks;
  }, [detail, localId, sectionIndex]);
  const allTrackCount = detail?.tracks.length ?? 0;
  const totalSeconds = trackDuration(primaryTracks);
  const play = (shuffle = false) => {
    if (!primaryTracks.length || !detail) return;
    const queue = shuffle ? shuffledTracks(primaryTracks) : primaryTracks;
    usePlaybackStore.getState().playTracks(queue, 0, detail.title || 'Collection');
  };
  const back = () => window.history.state?.idx > 0 ? navigate(-1) : navigate('/library', { replace: true });

  useEffect(() => {
    let active = true;
    if (!detail || (detail.kind !== 'album' && detail.kind !== 'artist')) { setSaved(false); return () => { active = false; }; }
    void isEntitySaved(detail.kind, detail.id).then((value) => { if (active) setSaved(value); }).catch(() => { if (active) setSaved(false); });
    return () => { active = false; };
  }, [detail?.kind, detail?.id]);

  const toggleSaved = async () => {
    if (!detail || (detail.kind !== 'album' && detail.kind !== 'artist') || saving) return;
    setSaving(true);
    setShareMessage('');
    try {
      const next = !saved;
      await setEntitySaved(detail, next);
      setSaved(next);
    } catch {
      setShareMessage(`Could not ${saved ? 'remove this from' : 'save this to'} your library. Try again.`);
    } finally { setSaving(false); }
  };

  const saveRemotePlaylist = async () => {
    if (!detail || detail.kind !== 'playlist' || !primaryTracks.length || saving) return;
    setSaving(true);
    setShareMessage('');
    try {
      const existing = playlists.find((playlist) => playlist.name === detail.title
        && playlist.tracks.length === primaryTracks.length
        && playlist.tracks.every((track, index) => track.id === primaryTracks[index]?.id));
      const savedPlaylist = existing ?? await createPlaylistFromTracks(detail.title, primaryTracks);
      setSavedPlaylistId(savedPlaylist.id);
      setShareMessage(existing ? 'This playlist is already in your library.' : 'Playlist saved to your library.');
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : 'This playlist could not be saved. Try again.');
    } finally { setSaving(false); }
  };

  const sharePlaylist = async () => {
    if (!localPlaylist) return;
    const playlist = { ...localPlaylist, tracks: localPlaylist.tracks.filter((track) => track.source === 'remote') };
    const file = new File([JSON.stringify({ format: 'aurora-library', version: 3, exportedAt: new Date().toISOString(), playlists: [playlist] }, null, 2)], `${playlist.name.replace(/[^a-z0-9-]/gi, '-').slice(0, 48) || 'aurora-playlist'}.json`, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: playlist.name });
      else {
        const url = URL.createObjectURL(file);
        const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setShareMessage('Playlist downloaded. Send the file and import it on another device in Settings.');
      }
    } catch (error) { if ((error as Error).name !== 'AbortError') setShareMessage('Could not share this playlist. Try again.'); }
  };

  if (query.isLoading && !localId) return <div className="page entity-page"><Skeleton className="entity-hero-skeleton" /><div className="song-list">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="row-skeleton" />)}</div></div>;
  if (query.isError) return <div className="page entity-page"><button className="back-button" onClick={back}><Icon name="arrow-left" /> Back</button><ErrorState message={query.error instanceof Error ? query.error.message : 'This page could not be loaded.'} retry={() => void query.refetch()} /></div>;
  if (!detail) return <div className="page entity-page"><button className="back-button" onClick={back}><Icon name="arrow-left" /> Back</button><EmptyState title="Collection not found">This playlist may have been removed from this browser.</EmptyState></div>;

  const metadata = metaValue(detail, primaryTracks.length || allTrackCount, totalSeconds);
  const artistName = detail.kind === 'album' ? detail.artist || primaryTracks[0]?.artist : '';
  const supportingSections = detail.sections.filter((_, index) => index !== sectionIndex);

  return <div className="page entity-page">
    <button className="back-button" onClick={back}><Icon name="arrow-left" /> Back</button>
    <section className={`entity-hero entity-${detail.kind}`}>
      <div className="entity-ambient" style={detail.artwork ? { backgroundImage: `url("${detail.artwork.replace(/"/g, '%22')}")` } : undefined} />
      <Artwork className="entity-artwork" src={detail.artwork} title={detail.title} rounded={detail.kind === 'artist'} />
      <div className="entity-copy">
        <span>{detail.kind === 'artist' ? 'Artist' : detail.kind === 'album' ? 'Album' : localId ? 'Your playlist' : 'Playlist'}</span>
        <h1>{detail.title}</h1>
        {detail.kind === 'album' && artistName ? <p className="entity-subtitle">{detail.artistId
          ? <Link to={`/artist/${encodeURIComponent(detail.artistId)}`}>{artistName}</Link>
          : artistName}</p> : detail.kind === 'playlist' && (detail.subtitle || localId) ? <p className="entity-subtitle">{localId ? 'Made by you' : detail.subtitle}</p> : detail.subtitle && <p className="entity-subtitle">{detail.subtitle}</p>}
        {detail.description && <p className="entity-description">{detail.description}</p>}
        <small className="entity-meta">{metadata.join(' · ') || `${allTrackCount} tracks`}</small>
        <div className="entity-actions">
          <button className="primary-button" onClick={() => play()} disabled={!primaryTracks.length}><Icon name="play" size={17} /> Play</button>
          <button className="secondary-button" onClick={() => play(true)} disabled={!primaryTracks.length}><Icon name="shuffle" size={17} /> Shuffle</button>
          {(detail.kind === 'album' || detail.kind === 'artist') && <button className="secondary-button entity-save-button" onClick={() => void toggleSaved()} disabled={saving} aria-pressed={saved}>
            <Icon name={detail.kind === 'artist' ? 'users' : 'heart'} size={16} /> {saving ? 'Saving…' : detail.kind === 'artist' ? saved ? 'Following' : 'Follow' : saved ? 'Saved' : 'Save album'}
          </button>}
          {detail.kind === 'playlist' && !localId && <button className="secondary-button entity-save-button" onClick={() => void saveRemotePlaylist()} disabled={saving || !primaryTracks.length}>
            <Icon name="plus" size={16} /> {saving ? 'Saving…' : savedPlaylistId ? 'Saved' : 'Save to Your Library'}
          </button>}
          {localId && localPlaylist && <button className="secondary-button" onClick={() => void sharePlaylist()}><Icon name="share" size={16} /> Share playlist</button>}
          {localId && localPlaylist && <button className="icon-danger" onClick={() => { if (window.confirm(`Delete “${localPlaylist.name}”?`)) { void deletePlaylist(localPlaylist.id).then(() => navigate('/library?tab=playlists')).catch(() => setShareMessage('Playlist could not be deleted. Try again.')); } }} aria-label="Delete playlist"><Icon name="trash" /></button>}
        </div>
      </div>
    </section>

    {shareMessage && <p role="status" className="transition-note">{shareMessage}{savedPlaylistId && <Link to={`/playlist/local/${encodeURIComponent(savedPlaylistId)}`}> Open saved playlist</Link>}</p>}

    {localPlaylist && <div className="playlist-edit-entry">
      <div><strong>Build your playlist</strong><span>Add songs from Search, then use the menu beside any track.</span></div>
      <div className="playlist-edit-actions">
        <Link className="secondary-button" to="/search"><Icon name="search" size={16} /> Find songs</Link>
        <button className="secondary-button" onClick={() => setEditing((value) => !value)}><Icon name="sliders" size={16} />{editing ? 'Done editing' : 'Edit playlist'}</button>
        <Link className="secondary-button" to={`/ai?playlist=${encodeURIComponent(localPlaylist.id)}`}><Icon name="sparkles" size={16} /> Extend with AI</Link>
      </div>
    </div>}
    {editing && localPlaylist && <PlaylistEditor key={localPlaylist.id} playlist={localPlaylist} onClose={() => setEditing(false)} />}

    {primaryTracks.length > 0 && !editing && <section className="entity-tracks" aria-label={detail.kind === 'artist' ? 'Popular tracks' : 'Tracks'}>
      <header className="section-header"><h2>{detail.kind === 'artist' ? 'Popular tracks' : detail.kind === 'album' ? 'Track list' : 'Songs'}</h2><span>{trackWord(primaryTracks.length)}{totalSeconds > 0 ? ` · ${formatDuration(totalSeconds)}` : ''}</span></header>
      <div className="song-list">{primaryTracks.map((track, index) => <SongRow key={`${track.id}-${index}`} track={track} context={primaryTracks} contextLabel={detail.title} index={index} playlistId={localId || undefined} showPosition={detail.kind !== 'artist'} />)}</div>
    </section>}

    {!primaryTracks.length && !supportingSections.some((section) => section.items.length) && <EmptyState icon="music" title={detail.kind === 'artist' ? 'No popular tracks yet' : 'No tracks here yet'} action={localId ? <Link className="primary-button" to="/search">Find music</Link> : undefined}>{localId ? 'Find songs, then use a song menu to add them to this playlist.' : 'This collection does not expose playable tracks.'}</EmptyState>}

    {supportingSections.map((section, sectionPosition) => {
      const sectionTracks = section.items.filter(isTrack);
      const entities = section.items.filter((item) => !isTrack(item));
      return <section className="content-section entity-related-section" key={`${section.id}-${sectionPosition}`}>
        <header className="section-header"><h2>{section.title}</h2>{section.items.length > 0 && <span>{section.items.length} {section.items.length === 1 ? 'item' : 'items'}</span>}</header>
        {sectionTracks.length > 0 && entities.length === 0 && <div className="song-list">{sectionTracks.map((track, index) => <SongRow key={`${track.id}-${index}`} track={track} context={sectionTracks} contextLabel={section.title} index={index} />)}</div>}
        {entities.length > 0 && <div className="horizontal-shelf">{entities.map((item, index) => <MediaCard key={`${item.id}-${index}`} item={item} context={sectionTracks} contextLabel={section.title} />)}</div>}
        {sectionTracks.length > 0 && entities.length > 0 && <div className="entity-section-songs">{sectionTracks.map((track, index) => <SongRow key={`${track.id}-${index}`} track={track} context={sectionTracks} contextLabel={section.title} index={index} />)}</div>}
      </section>;
    })}
  </div>;
}
