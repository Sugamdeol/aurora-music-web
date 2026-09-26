import { useState } from 'react';
import type { LocalPlaylist } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { Artwork, IconButton } from './primitives';
import { Icon } from './Icon';

export function PlaylistEditor({ playlist, onClose }: { playlist: LocalPlaylist; onClose: () => void }) {
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { await useLibraryStore.getState().editPlaylist(playlist.id, name, description); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Changes could not be saved.'); }
    finally { setBusy(false); }
  };
  const move = async (from: number, to: number) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await useLibraryStore.getState().reorderPlaylist(playlist.id, from, to); }
    catch { setError('The song order could not be saved. Try again.'); }
    finally { setBusy(false); }
  };
  return <section className="playlist-editor glass-surface" aria-label="Edit playlist">
    <header><h2>Make this playlist yours</h2><IconButton icon="x" label="Close playlist editor" disabled={busy} onClick={onClose} /></header>
    <form onSubmit={(event) => void save(event)}><label>Playlist name<input required maxLength={64} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Description<textarea maxLength={400} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A mood, a moment, a little context…" /></label><button className="primary-button" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save details'}</button></form>
    {error && <p className="danger" role="alert">{error}</p>}
    {playlist.tracks.length > 0 && <><h3>Song order</h3><p className="playlist-order-note">Moves are saved immediately.</p><div className="playlist-order-list">{playlist.tracks.map((track, index) => <div key={track.id}><span>{index + 1}</span><Artwork src={track.artwork} title={track.title} /><div><strong>{track.title}</strong><small>{track.artist}</small></div><IconButton icon="chevron-right" className="queue-move queue-move-up" label={`Move ${track.title} up`} disabled={busy || index === 0} onClick={() => void move(index, index - 1)} /><IconButton icon="chevron-right" className="queue-move queue-move-down" label={`Move ${track.title} down`} disabled={busy || index === playlist.tracks.length - 1} onClick={() => void move(index, index + 1)} /></div>)}</div></>}
  </section>;
}
