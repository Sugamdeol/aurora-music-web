import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { suggestMusic } from '../lib/keylessAi';
import type { MediaTrack } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { SongRow } from '../components/Media';
import { Icon } from '../components/Icon';
import { AgentPanel } from './AgentPanel';
import './AiPage.css';

type Mode = 'create' | 'extend' | 'discover';
type Preview = { title: string; description: string; tracks: MediaTrack[] };
const examples = ['Late night Punjabi drive', 'Soft Hindi songs for rainy evenings', 'High energy workout pop', 'Calm instrumentals for studying'];

export function AiPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const playlists = useLibraryStore((state) => state.playlists);
  const liked = useLibraryStore((state) => state.likedTracks);
  const [panel, setPanel] = useState<'mix' | 'agent'>(params.get('tab') === 'agent' ? 'agent' : 'mix');
  const [mode, setMode] = useState<Mode>(params.has('playlist') ? 'extend' : 'create');
  const [playlistId, setPlaylistId] = useState(params.get('playlist') || '');
  const [prompt, setPrompt] = useState(params.get('prompt')?.slice(0, 300) ?? '');
  useEffect(() => { const next = params.get('prompt'); if (next) { setPrompt(next.slice(0, 300)); setPanel('mix'); } }, [params.get('prompt')]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState('');
  const target = playlists.find((playlist) => playlist.id === playlistId);
  const tracks = preview?.tracks.filter((track) => selected.includes(track.id)) ?? [];

  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || prompt.trim().length < 3) return;
    if (mode === 'extend' && !target) { setError('Choose a playlist first.'); return; }
    setBusy(true); setError(''); setNotice(''); setFallbackNotice(''); setPreview(null);
    try {
      const seeds = mode === 'extend' ? target!.tracks : mode === 'discover' ? liked : [];
      let idea: { title: string; description: string; queries: string[] };
      try { idea = await suggestMusic(prompt.trim(), mode, seeds.filter((track) => track.source === 'remote').slice(0, 8).map((track) => `${track.title} — ${track.artist}`)); }
      catch { idea = { title: prompt.trim().slice(0, 64), description: '', queries: [prompt.trim().slice(0, 100)] }; setFallbackNotice('Keyless AI is busy. These are catalog search results for your description.'); }
      const result = { title: idea.title, description: idea.description, tracks: await api.resolveAiSongs(idea.queries) };
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
    <header className="ai-page-head"><div><span className="ai-kicker"><span className="ai-kicker-dot" /> YOUR MUSIC, YOUR WAY</span><h1>Aurora <em>Studio.</em></h1><p>Find the right song for right now.</p></div><div className="ai-main-tabs" role="group" aria-label="Aurora Studio tools"><button aria-pressed={panel === 'mix'} className={panel === 'mix' ? 'active' : ''} onClick={() => setPanel('mix')}><Icon name="disc" size={17} /> Mix maker</button><button aria-pressed={panel === 'agent'} className={panel === 'agent' ? 'active' : ''} onClick={() => setPanel('agent')}><Icon name="sparkles" size={17} /> Ask Aurora</button></div></header>
    {panel === 'agent' ? <AgentPanel /> : <>
    <div className="ai-stage">
      <section className="ai-showcase" aria-labelledby="ai-showcase-title"><div className="ai-showcase-top"><span>THE LISTENING ROOM</span><Icon name="sparkles" size={17} /></div><div className="ai-record" aria-hidden="true"><div className="ai-record-label"><img src="/aurora.svg" alt="" /></div></div><div className="ai-showcase-copy"><span>CURATED BY YOU · POWERED BY CURIOSITY</span><h2 id="ai-showcase-title">A soundtrack for <em>every</em> version of you.</h2><p>One thought. A whole new world of songs.</p></div><span className="ai-showcase-index" aria-hidden="true">A / 01</span></section>
      <form className="ai-form glass-surface" onSubmit={(event) => void generate(event)}>
        <div className="ai-form-heading"><span className="ai-form-mark"><Icon name="sparkles" size={19} /></span><div><span className="ai-kicker">THE MIX MAKER</span><h2>{mode === 'create' ? 'What are we feeling?' : mode === 'extend' ? 'Keep the feeling going.' : 'Let’s find something new.'}</h2><p>{mode === 'extend' ? 'Give an old favourite some new company.' : 'Describe a mood, moment, or artist.'}</p></div></div>
        <div className="ai-mode-row" role="group" aria-label="Mix type">{([['create', 'New mix'], ['extend', 'Add songs'], ['discover', 'Explore']] as const).map(([value, label]) => <button type="button" key={value} className={`ai-mode ${mode === value ? 'active' : ''}`} aria-pressed={mode === value} onClick={() => { setMode(value); setPreview(null); setError(''); }}><Icon name={value === 'create' ? 'plus' : value === 'extend' ? 'disc' : 'sparkles'} size={16} />{label}</button>)}</div>
        {mode === 'extend' && <label className="ai-label">Choose a playlist<select value={playlistId} onChange={(event) => { setPlaylistId(event.target.value); setPreview(null); }} required><option value="">Select your playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} ({playlist.tracks.length} songs)</option>)}</select></label>}
        <label className="ai-label">Tell us the vibe<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={300} rows={3} placeholder="Rainy evening, soft Punjabi songs…" required minLength={3} /></label>
        <div className="ai-example-wrap"><span>TRY A VIBE</span><div className="ai-examples">{examples.map((example) => <button type="button" key={example} onClick={() => setPrompt(example)}>{example}</button>)}</div></div>
        <button type="submit" className="primary-button ai-generate" disabled={busy || prompt.trim().length < 3 || (mode === 'extend' && !target)} aria-busy={busy}><Icon name="sparkles" size={18} /> {busy ? 'Finding your songs…' : 'Make my mix'} <span aria-hidden="true">↗</span></button>
        <p className="ai-privacy">When you generate, your prompt and up to eight song titles go to LLM7. <strong>No account needed.</strong></p>
      </form>
    </div>
    {error && <p className="ai-alert" role="alert">{error}</p>}
    {fallbackNotice && <p className="ai-success" role="status">{fallbackNotice}</p>}
    {notice && <p className="ai-success" role="status">{notice} <Link to={`/playlist/local/${encodeURIComponent(playlistId)}`}>Open playlist</Link></p>}
    {preview && <section className="ai-preview" aria-label="AI mix preview"><div className="ai-preview-head"><div className="ai-preview-art" aria-hidden="true">{preview.tracks.slice(0, 4).map((track) => track.artwork && <img key={track.id} src={track.artwork} alt="" />)}</div><div className="ai-preview-copy"><span className="ai-eyebrow">READY TO LISTEN · {tracks.length} SELECTED</span><input aria-label="Mix title" value={preview.title} maxLength={64} onChange={(event) => setPreview({ ...preview, title: event.target.value })} /><p>{preview.description || 'Made from the music you had in mind.'}</p></div><div className="ai-preview-actions"><button className="secondary-button" disabled={!tracks.length} onClick={() => usePlaybackStore.getState().playTracks(tracks, 0, preview.title)}><Icon name="play" size={16} /> Play</button><button className="primary-button" disabled={!tracks.length || !preview.title.trim() || saving} onClick={() => void save()}>{saving ? 'Saving…' : mode === 'extend' ? 'Add selected' : 'Save playlist'}</button></div></div>
      <div className="song-list">{preview.tracks.map((track, index) => <div className="ai-track" key={track.id}><label className="ai-track-choice"><input type="checkbox" checked={selected.includes(track.id)} aria-label={`Include ${track.title}`} onChange={() => setSelected((current) => current.includes(track.id) ? current.filter((id) => id !== track.id) : [...current, track.id])} /></label><div className="ai-track-row"><SongRow track={track} context={preview.tracks} contextLabel={preview.title} index={index} /></div></div>)}</div>
      <small className="ai-catalog-note">Songs come from Aurora’s music catalog. Listen before saving and uncheck anything you don’t want.</small>
    </section>}
    </>}
  </div>;
}
