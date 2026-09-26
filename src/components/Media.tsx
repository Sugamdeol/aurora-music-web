import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaEntity, MediaTrack } from '../domain/media';
import { formatDuration } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { Artwork, IconButton } from './primitives';
import { Icon } from './Icon';
import { TrackActions } from './TrackActions';

interface SongRowProps {
  track: MediaTrack;
  context?: MediaTrack[];
  contextLabel?: string;
  index?: number;
  playlistId?: string;
}

export function SongRow({ track, context = [track], contextLabel = 'Queue', index = 0, playlistId }: SongRowProps) {
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
  const [menuOpen, setMenuOpen] = useState(false);
  const active = current?.id === track.id;

  const play = () => {
    if (active) usePlaybackStore.getState().togglePlayback();
    else playTrack(track, context, contextLabel, index);
  };

  return <article className={`song-row ${active ? 'is-current' : ''}`} style={{ '--row-index': index } as React.CSSProperties}>
    <button className="song-row-art" onClick={play} aria-label={`${active && isPlaying ? 'Pause' : 'Play'} ${track.title}`}>
      <Artwork src={track.artwork} title={track.title} />
      <span className="song-row-play"><Icon name={active && isPlaying ? 'pause' : 'play'} size={16} /></span>
    </button>
    <button className="song-row-copy" onClick={play}>
      <strong>{track.title}</strong>
      <span>{track.artist}{track.album ? ` · ${track.album}` : ''}{track.kind === 'local' ? ' · Local file' : ''}</span>
    </button>
    <span className="song-row-duration">{track.durationLabel || formatDuration(track.durationSeconds)}</span>
    <IconButton icon="heart" label={liked ? 'Remove from liked songs' : 'Add to liked songs'} active={liked} className="song-like" onClick={() => void toggleLike(track)} />
    <div className="row-menu-wrap">
      <IconButton icon="more" label={`More options for ${track.title}`} onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} />
      {menuOpen && <div className="row-menu" role="menu">
        <button role="menuitem" onClick={() => { addToQueue(track, true); setMenuOpen(false); }}>Play next</button>
        <button role="menuitem" onClick={() => { addToQueue(track); setMenuOpen(false); }}>Add to queue</button>
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
