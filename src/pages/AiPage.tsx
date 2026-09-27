import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { MediaTrack } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { SongRow } from '../components/Media';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/primitives';
import './AiPage.css';

type Mode = 'create' | 'extend' | 'discover';
type Preview = { title: string; description: string; tracks: MediaTrack[] };
const examples = ['Late night Punjabi drive', 'Soft Hindi songs for rainy evenings', 'High energy workout pop', 'Calm instrumentals for studying'];

export function AiPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const playlists = useLibraryStore((state) => state.playlists);
  const liked = useLibraryStore((state) => state.likedTracks);
  const [mode, setMode] = useState<Mode>(params.has('playlist') ? 'extend' : 'create');
  const [playlistId, setPlaylistId] = useState(params.get('playlist') || '');
  const [prompt, setPrompt] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const target = playlists.find((playlist) => playlist.id === playlistId);
  const tracks = preview?.tracks.filter((track) => selected.includes(track.id)) ?? [];

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || prompt.trim().length < 3) return;
    if (mode === 'extend' && !target) { setError('Choose a playlist first.'); return; }
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try {
      const seeds = mode === 'extend' ? target!.tracks : mode === 'discover' ? liked : [];
      const result = await api.aiMusic(prompt.trim(), mode, seeds.filter((track) => track.source === 'remote').slice(0, 8).map((track) => `${track.title} — ${track.artist}`));
      const fresh = mode === 'extend' ? result.tracks.filter((track) => !target!.tracks.some((existing) => existing.id === track.id)) : result.tracks;
      if (!fresh.length) throw new Error('No new songs found. Try a different description.');
      setPreview({ ...result, tracks: fresh });
      setSelected(fresh.map((track) => track.id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not make a mix. Try again.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview || !tracks.length || saving) return;
    setSaving(true); setError('');
    try {
      if (mode === 'extend' && target) {
        for (const track of tracks) await useLibraryStore.getState().addToPlaylist(target.id, track);
        setNotice(`Added ${tracks.length} songs to ${target.name}.`);
        setPreview(null);
      } else {
        const playlist = await useLibraryStore.getState().createPlaylistFromTracks(preview.title, tracks);
        if (preview.description) await useLibraryStore.getState().editPlaylist(playlist.id, preview.title, preview.description);
        navigate(`/playlist/local/${encodeURIComponent(playlist.id)}`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the playlist.'); }
    finally { setSaving(false); }
  };

  return <div className="page ai-page">
    <PageHeader title="AI Mix" description="Describe a feeling, artist, or moment. Aurora finds real songs you can play and save." />
    <div className="ai-mode-row" role="group" aria-label="AI music action">
      {([['create', 'Create playlist'], ['extend', 'Extend playlist'], ['discover', 'Discover songs']] as const).map(([value, label]) => <button key={value} className={`ai-mode ${mode === value ? 'active' : ''}`} aria-pressed={mode === value} onClick={() => { setMode(value); setPreview(null); setError(''); }}><Icon name={value === 'create' ? 'plus' : value === 'extend' ? 'disc' : 'sparkles'} size={18} />{label}</button>)}
    </div>
    <form className="ai-form glass-surface" onSubmit={(event) => void generate(event)}>
      <div className="ai-form-heading"><span className="ai-orb"><Icon name="sparkles" size={23} /></span><div><h2>{mode === 'create' ? 'Make a mix from a thought' : mode === 'extend' ? 'Find the next songs' : 'Follow your curiosity'}</h2><p>{mode === 'extend' ? 'Pick a playlist and describe what should come next.' : 'Tell us what you feel like listening to.'}</p></div></div>
      {mode === 'extend' && <label className="ai-label">Your playlist<select value={playlistId} onChange={(event) => { setPlaylistId(event.target.value); setPreview(null); }} required><option value="">Choose a playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} ({playlist.tracks.length})</option>)}</select></label>}
      <label className="ai-label">Describe your music<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={300} rows={3} placeholder="A calm rainy evening with soft Punjabi songs…" required minLength={3} /></label>
      <div className="ai-examples">{examples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}</div>
      <div className="ai-form-foot"><small>Your prompt and up to eight song titles are sent to LLM7 when you tap Generate. No account or key needed.</small><button type="submit" className="primary-button" disabled={busy || prompt.trim().length < 3 || (mode === 'extend' && !target)}><Icon name="sparkles" size={18} /> {busy ? 'Finding your songs…' : 'Generate songs'}</button></div>
    </form>
    {error && <p className="ai-alert" role="alert">{error}</p>}
    {notice && <p className="ai-success" role="status">{notice} <Link to={`/playlist/local/${encodeURIComponent(playlistId)}`}>Open playlist</Link></p>}
    {preview && <section className="ai-preview" aria-label="AI mix preview"><div className="ai-preview-head"><div><span className="ai-eyebrow">YOUR PREVIEW · {tracks.length} SELECTED</span><input aria-label="Mix title" value={preview.title} maxLength={64} onChange={(event) => setPreview({ ...preview, title: event.target.value })} /><p>{preview.description}</p></div><div className="ai-preview-actions"><button className="secondary-button" disabled={!tracks.length} onClick={() => usePlaybackStore.getState().playTracks(tracks, 0, preview.title)}><Icon name="play" size={16} /> Play</button><button className="primary-button" disabled={!tracks.length || !preview.title.trim() || saving} onClick={() => void save()}>{saving ? 'Saving…' : mode === 'extend' ? 'Add selected' : 'Save playlist'}</button></div></div>
      <div className="song-list">{preview.tracks.map((track, index) => <div className="ai-track" key={track.id}><label className="ai-track-choice"><input type="checkbox" checked={selected.includes(track.id)} aria-label={`Include ${track.title}`} onChange={() => setSelected((current) => current.includes(track.id) ? current.filter((id) => id !== track.id) : [...current, track.id])} /></label><div className="ai-track-row"><SongRow track={track} context={preview.tracks} contextLabel={preview.title} index={index} /></div></div>)}</div>
      <small className="ai-catalog-note">Songs come from Aurora’s music catalog. Listen before saving and uncheck anything you don’t want.</small>
    </section>}
  </div>;
}
