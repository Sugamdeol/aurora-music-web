import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { EntityDetail, MediaTrack } from '../domain/media';
import { api } from '../lib/api';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { MediaCard, SongRow } from '../components/Media';
import { Artwork, EmptyState, ErrorState, Skeleton } from '../components/primitives';
import { Icon } from '../components/Icon';
import { shuffledTracks } from '../lib/collections';
import { PlaylistEditor } from '../components/PlaylistEditor';

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
  const [editing, setEditing] = useState(false);
  const query = useQuery({ queryKey: ['entity', kind, id], queryFn: ({ signal }) => api.entity(kind, id, signal), enabled: Boolean(id) && !localId, staleTime: 5 * 60_000, retry: 1 });

  const detail = useMemo<EntityDetail | undefined>(() => localPlaylist ? {
    kind: 'playlist', id: localPlaylist.id, title: localPlaylist.name, description: localPlaylist.description,
    artwork: localPlaylist.artwork || localPlaylist.tracks[0]?.artwork,
    sections: [], tracks: localPlaylist.tracks,
  } : query.data, [localPlaylist, query.data]);
  const tracks = detail?.tracks ?? [];
  const play = (shuffle = false) => {
    if (!tracks.length) return;
    const queue = shuffle ? shuffledTracks(tracks) : tracks;
    usePlaybackStore.getState().playTracks(queue, 0, detail?.title || 'Collection');
  };

  if (query.isLoading && !localId) return <div className="page entity-page"><Skeleton className="entity-hero-skeleton" /><div className="song-list">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="row-skeleton" />)}</div></div>;
  if (query.isError) return <div className="page entity-page"><button className="back-button" onClick={() => navigate(-1)}><Icon name="arrow-left" /> Back</button><ErrorState message={query.error instanceof Error ? query.error.message : 'This page could not be loaded.'} retry={() => void query.refetch()} /></div>;
  if (!detail) return <div className="page entity-page"><EmptyState title="Collection not found">This playlist may have been removed from this browser.</EmptyState></div>;

  return <div className="page entity-page">
    <button className="back-button" onClick={() => navigate(-1)}><Icon name="arrow-left" /> Back</button>
    <section className={`entity-hero entity-${detail.kind}`}>
      <div className="entity-ambient" style={detail.artwork ? { backgroundImage: `url("${detail.artwork.replace(/"/g, '%22')}")` } : undefined} />
      <Artwork className="entity-artwork" src={detail.artwork} title={detail.title} rounded={detail.kind === 'artist'} />
      <div className="entity-copy"><span>{detail.kind === 'artist' ? 'Artist' : detail.kind === 'album' ? 'Album' : localId ? 'Your playlist' : 'Playlist'}</span><h1>{detail.title}</h1>{detail.subtitle && <p className="entity-subtitle">{detail.subtitle}</p>}{detail.description && <p className="entity-description">{detail.description}</p>}<small>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</small>
        <div className="entity-actions"><button className="primary-button" onClick={() => play()} disabled={!tracks.length}><Icon name="play" size={17} /> Play</button><button className="secondary-button" onClick={() => play(true)} disabled={!tracks.length}><Icon name="shuffle" size={17} /> Shuffle</button>{localId && localPlaylist && <button className="icon-danger" onClick={() => { if (window.confirm(`Delete “${localPlaylist.name}”?`)) { void deletePlaylist(localPlaylist.id).then(() => navigate('/library?tab=playlists')); } }} aria-label="Delete playlist"><Icon name="trash" /></button>}</div>
      </div>
    </section>

    {localPlaylist && <div className="playlist-edit-entry"><button className="secondary-button" onClick={() => setEditing((value) => !value)}><Icon name="sliders" size={16} />{editing ? 'Done editing' : 'Edit playlist and song order'}</button></div>}
    {editing && localPlaylist && <PlaylistEditor key={localPlaylist.id} playlist={localPlaylist} onClose={() => setEditing(false)} />}
    {tracks.length > 0 && !editing && <section className="entity-tracks"><header className="section-header"><h2>{detail.kind === 'artist' ? 'Popular tracks' : 'Track list'}</h2><span>{tracks.length} songs</span></header><div className="song-list">{tracks.map((track, index) => <SongRow key={`${track.id}-${index}`} track={track} context={tracks} contextLabel={detail.title} index={index} playlistId={localId || undefined} />)}</div></section>}
    {!tracks.length && <EmptyState icon="music" title="No tracks here yet" action={localId ? <Link className="primary-button" to="/search">Find music</Link> : undefined}>{localId ? 'Use a song menu to add music to this playlist.' : 'This collection does not expose playable tracks.'}</EmptyState>}

    {detail.sections.filter((section) => section.items.some((item) => !('source' in item))).map((section) => {
      const sectionTracks = section.items.filter((item): item is MediaTrack => 'source' in item);
      return <section className="content-section" key={section.id}><header className="section-header"><h2>{section.title}</h2></header><div className="horizontal-shelf">{section.items.map((item, index) => <MediaCard key={`${item.id}-${index}`} item={item} context={sectionTracks} contextLabel={section.title} />)}</div></section>;
    })}
  </div>;
}
