import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaEntity, MediaTrack } from '../domain/media';
import { formatDuration } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { Artwork, IconButton } from './primitives';
import { Icon } from './Icon';
import { TrackActions } from './TrackActions';
import { useRecommendationStore } from '../store/recommendations';

interface SongRowProps {
  track: MediaTrack;
  context?: MediaTrack[];
  contextLabel?: string;
  index?: number;
  playlistId?: string;
  showPosition?: boolean;
}

export function SongRow({ track, context = [track], contextLabel = 'Queue', index = 0, playlistId, showPosition = false }: SongRowProps) {
  const current = usePlaybackStore((state) => state.currentTrack);
  const isPlaying = usePlaybackStore((state) => state.isPlaying);
  const playTrack = usePlaybackStore((state) => state.playTrack);
  const addToQueue = usePlaybackStore((state) => state.addToQueue);
  const liked = useLibraryStore((state) => state.likedIds.has(track.id));
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const playlists = useLibraryStore((state) => state.playlists);
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);
  const removeFromPlaylist = useLibraryStore((state) => state.removeFromPlaylist);
  const removeLocal = useLibraryStore((state) => state.removeLocalTrack);
  const hiddenSuggestions = useRecommendationStore((state) => state.hidden);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = current?.id === track.id;
  // Menus close on Escape and on outside pointer — no orphaned floating menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setMenuOpen(false); } };
    const onPointer = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPointer); };
  }, [menuOpen]);

  const play = () => {
    if (active) usePlaybackStore.getState().togglePlayback();
    else playTrack(track, context, contextLabel, index);
  };

  return <article className={`song-row ${active ? 'is-current' : ''} ${showPosition ? 'has-position' : ''}`} style={{ '--row-index': index } as React.CSSProperties}>
    {showPosition && <span className="song-row-position" aria-label={`Track ${index + 1}`}>{index + 1}</span>}
    <button className="song-row-art" onClick={play} aria-label={`${active && isPlaying ? 'Pause' : 'Play'} ${track.title}`}>
      <Artwork src={track.artwork} title={track.title} />
      {active && isPlaying
        ? <span className="song-row-play now-bars" aria-hidden="true"><i /><i /><i /></span>
        : <span className="song-row-play"><Icon name={active ? 'pause' : 'play'} size={16} /></span>}
    </button>
    <div className="song-row-copy">
      <button className="song-row-title" onClick={play}><strong>{track.title}</strong></button>
      <span>
        {(track.artists?.length ? track.artists : [{ id: track.artistId, name: track.artist }]).map((artist, artistIndex) => <span key={`${artist.id ?? artist.name}-${artistIndex}`} className="song-row-credit">{artistIndex > 0 && ', '}{artist.id ? <Link to={`/artist/${encodeURIComponent(artist.id)}`}>{artist.name}</Link> : artist.name}</span>)}
        {track.album && <> · {track.albumId ? <Link to={`/album/${encodeURIComponent(track.albumId)}`}>{track.album}</Link> : track.album}</>}
        {track.kind === 'local' ? ' · Local file' : ''}
      </span>
    </div>
    <span className="song-row-duration">{track.durationLabel || formatDuration(track.durationSeconds)}</span>
    <IconButton icon="heart" label={liked ? 'Remove from liked songs' : 'Add to liked songs'} active={liked} className="song-like" onClick={() => void toggleLike(track)} />
    <div className="row-menu-wrap" ref={menuRef}>
      <IconButton icon="more" label={`More options for ${track.title}`} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-haspopup="menu" />
      {menuOpen && <div className="row-menu" role="menu">
        <button role="menuitem" onClick={() => { addToQueue(track, true); setMenuOpen(false); }}>Play next</button>
        <button role="menuitem" onClick={() => { addToQueue(track); setMenuOpen(false); }}>Add to queue</button>
        {track.source === 'remote' && <button role="menuitem" onClick={() => { useRecommendationStore.getState().toggleHidden(track.id); setMenuOpen(false); }}>{hiddenSuggestions.includes(track.id) ? 'Allow suggestions for this song' : 'Don’t suggest this song'}</button>}
        <TrackActions track={track} menu onComplete={() => setMenuOpen(false)} />
        {playlists.length > 0 && <div className="menu-label">Add to playlist</div>}
        {playlists.map((playlist) => <button role="menuitem" key={playlist.id} onClick={() => { void addToPlaylist(playlist.id, track); setMenuOpen(false); }}>{playlist.name}</button>)}
        {playlistId && <button className="danger" role="menuitem" onClick={() => { void removeFromPlaylist(playlistId, track.id); setMenuOpen(false); }}>Remove from playlist</button>}
        {track.source === 'local' && <button className="danger" role="menuitem" onClick={() => { void removeLocal(track.id); setMenuOpen(false); }}>Remove local file</button>}
      </div>}
    </div>
  </article>;
}

export function MediaCard({ item, context, contextLabel }: { item: MediaEntity | MediaTrack; context?: MediaTrack[]; contextLabel?: string }) {
  const playTrack = usePlaybackStore((state) => state.playTrack);
  const isSong = 'source' in item;
  const card = <>
    <Artwork src={item.artwork} title={item.title} rounded={item.kind === 'artist'} />
    <span className="media-card-overlay"><Icon name={isSong ? 'play' : 'chevron-right'} size={17} /></span>
    <strong>{item.title}</strong>
    <small>{isSong ? item.artist : item.subtitle || item.artist || item.kind}</small>
  </>;
  if (isSong) {
    return <button className={`media-card media-card-${item.kind}`} onClick={() => playTrack(item, context ?? [item], contextLabel)}>{card}</button>;
  }
  if (item.kind === 'artist' || item.kind === 'album' || item.kind === 'playlist') {
    const id = encodeURIComponent(item.browseId || item.id);
    const path = item.kind === 'playlist' ? `/playlist/remote/${id}` : `/${item.kind}/${id}`;
    return <Link className={`media-card media-card-${item.kind}`} to={path}>{card}</Link>;
  }
  return <div className="media-card">{card}</div>;
}

export function PlaylistCard({ id, title, artwork, count }: { id: string; title: string; artwork?: string; count: number }) {
  return <Link className="media-card media-card-playlist" to={`/playlist/local/${encodeURIComponent(id)}`}>
    <Artwork src={artwork} title={title} />
    <span className="media-card-overlay"><Icon name="chevron-right" size={17} /></span>
    <strong>{title}</strong><small>{count} {count === 1 ? 'song' : 'songs'}</small>
  </Link>;
}

