import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { getSetting, setSetting } from '../lib/db';
import { DEFAULT_LYRIC_PREFERENCES, LYRIC_LANGUAGES, LYRIC_SOURCES, parseCustomLyrics, pairCustomRomanization, type LyricPreferences } from '../lib/lyrics';
import { usePlaybackStore } from '../store/playback';
import { useRoomStore } from '../room/client';
import { lyricIndexAt } from '../lib/trackActions';
import { Icon } from './Icon';

export function TrackLyrics({ romanized }: { romanized: boolean }) {
  const track = usePlaybackStore((state) => state.currentTrack);
  const position = usePlaybackStore((state) => state.position);
  const seek = usePlaybackStore((state) => state.seek);
  const viewport = useRef<HTMLDivElement>(null);
  const [settings, setSettings] = useState<{ id: string; value: LyricPreferences }>();
  const [draft, setDraft] = useState('');
  const [romanDraft, setRomanDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [timing, setTiming] = useState<{ id: string; offset: number }>({ id: '', offset: 0 });
  const prefs = settings?.id === track?.id ? settings?.value : undefined;
  const offset = timing.id === track?.id ? timing.offset : 0;
  useEffect(() => {
    let active = true;
    setMessage(''); setBusy(false); setDraft(''); setRomanDraft('');
    if (track) void Promise.all([getSetting<LyricPreferences>(`lyrics.preferences.${track.id}`, DEFAULT_LYRIC_PREFERENCES), getSetting<number>(`lyrics.offset.${track.id}`, 0)]).then(([stored, value]) => {
      if (!active) return;
      const preferences = { ...DEFAULT_LYRIC_PREFERENCES, ...stored };
      if (!LYRIC_SOURCES.includes(preferences.source as typeof LYRIC_SOURCES[number])) preferences.source = 'auto';
      if (!LYRIC_LANGUAGES.some(([value]) => value === preferences.language)) preferences.language = 'auto';
      setSettings({ id: track.id, value: preferences }); setDraft(preferences.customText); setRomanDraft(preferences.customRomanized);
      setTiming({ id: track.id, offset: Number.isFinite(value) ? Math.max(-10000, Math.min(10000, value)) : 0 });
    }).catch(() => { if (active) { setSettings({ id: track.id, value: DEFAULT_LYRIC_PREFERENCES }); setMessage('Saved lyric settings could not be loaded.'); } });
    return () => { active = false; };
  }, [track?.id]);
  const updatePreferences = async (patch: Partial<LyricPreferences>) => {
    if (!track || !prefs) return;
    const value = { ...prefs, ...patch };
    setSettings({ id: track.id, value }); setMessage('');
    try { await setSetting(`lyrics.preferences.${track.id}`, value); }
    catch { setMessage('Settings changed, but could not be saved on this device.'); }
  };
  const adjustOffset = (value: number) => {
    if (!track) return;
    const next = Math.max(-10000, Math.min(10000, value));
    setTiming({ id: track.id, offset: next });
    void setSetting(`lyrics.offset.${track.id}`, next).catch(() => setMessage('Timing changed, but could not be saved.'));
  };
  const query = useQuery({ queryKey: ['lyrics', track?.id, prefs?.source, prefs?.language], queryFn: ({ signal }) => api.lyrics(track!, signal, { source: prefs!.source, language: prefs!.language }), enabled: Boolean(track && prefs && prefs.source !== 'custom' && track.source !== 'local'), staleTime: 30 * 60_000, retry: 1 });
  const custom = prefs?.source === 'custom';
  const lyrics = custom ? prefs.customLines : query.data?.lines ?? [];
  const synced = custom ? lyrics.some((line) => line.time !== undefined) : query.data?.synced;
  const approximate = custom ? prefs.approximate : query.data?.approximate;
  const currentLine = lyricIndexAt(useMemo(() => lyrics.map((line) => line.time), [lyrics]), position, offset);
  useEffect(() => {
    if (!synced || currentLine < 0) return;
    const active = viewport.current?.querySelector<HTMLElement>(`[data-lyric-index="${currentLine}"]`);
    const view = viewport.current;
    if (active && view) {
      const viewRect = view.getBoundingClientRect(); const rect = active.getBoundingClientRect();
      if (rect.top < viewRect.top + 70 || rect.bottom > viewRect.bottom - 90) view.scrollTo({ top: Math.max(0, rect.top - viewRect.top + view.scrollTop - view.clientHeight * .43), behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
    }
  }, [lyrics, currentLine, synced]);
  const saveCustom = async () => {
    if (!prefs || !track || busy) return;
    const id = track.id;
    setBusy(true); setMessage('');
    try {
      const original = parseCustomLyrics(draft);
      if (!original.length) throw new Error('Paste your lyrics first.');
      const result = romanDraft.trim() ? { lines: pairCustomRomanization(original, romanDraft), approximate: false } : await api.romanizeLyrics(original, prefs.language).catch(() => ({ lines: original, approximate: true }));
      const value = { ...prefs, source: 'custom', customText: draft, customRomanized: romanDraft, customLines: result.lines, approximate: result.approximate };
      await setSetting(`lyrics.preferences.${id}`, value);
      if (usePlaybackStore.getState().currentTrack?.id === id) { setSettings({ id, value }); setMessage('Your lyrics are saved on this device.'); }
    } catch (error) { if (usePlaybackStore.getState().currentTrack?.id === id) setMessage(error instanceof Error ? error.message : 'Lyrics could not be saved.'); }
    finally { if (usePlaybackStore.getState().currentTrack?.id === id) setBusy(false); }
  };
  const loading = !prefs || (!custom && query.isFetching);
  return <div className="lyrics-view lyrics-view-full">
    <details className="lyric-settings lyric-source-settings"><summary>Lyrics settings</summary>
      <div className="lyric-settings-fields">
        <label>Lyrics source<select aria-label="Lyrics source" disabled={!prefs || busy} value={prefs?.source ?? 'auto'} onChange={(event) => void updatePreferences({ source: event.target.value })}>{LYRIC_SOURCES.map((source) => <option key={source} value={source}>{source === 'auto' ? 'Automatic · best match' : source === 'custom' ? 'My own lyrics' : source}</option>)}</select></label>
        <label>Lyric language<select aria-label="Lyric language" disabled={!prefs || busy} value={prefs?.language ?? 'auto'} onChange={(event) => void updatePreferences({ language: event.target.value })}>{LYRIC_LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <div className="lyrics-provider">{custom ? 'My own lyrics' : query.data?.provider || 'No source loaded'} · {synced ? 'Synced' : 'Plain text'}</div>
      {approximate && <p>Romanization is approximate for this script. You can enter corrected lines below.</p>}
      <details className="custom-lyric-editor"><summary>Paste or edit your lyrics</summary><p>Plain text or LRC timestamps, like [00:12.50]. Saved for this song on this device.</p>
        <label>Your lyrics<textarea aria-label="Your lyrics" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={40000} rows={8} placeholder="[00:12.50] First line" /></label>
        <label>Your romanized lyrics (optional)<textarea aria-label="Your romanized lyrics" value={romanDraft} onChange={(event) => setRomanDraft(event.target.value)} maxLength={40000} rows={5} placeholder="Keep the same lines and timestamps. Leave blank to generate automatically." /></label>
        <button className="secondary-button" disabled={!prefs || busy || !draft.trim()} onClick={() => void saveCustom()}>{busy ? 'Saving lyrics…' : 'Save my lyrics'}</button>
        {!!prefs?.customLines.length && <button className="text-button" disabled={busy} onClick={() => { void updatePreferences({ source: 'auto', customText: '', customRomanized: '', customLines: [], approximate: false }); setDraft(''); setRomanDraft(''); }}>Remove my lyrics</button>}
      </details>
      {synced && <div className="lyric-timing"><span>Lyric timing</span><button aria-label="Show lyrics 250 milliseconds earlier" onClick={() => adjustOffset(offset - 250)}>−</button><output>{offset > 0 ? '+' : ''}{offset} ms</output><button aria-label="Show lyrics 250 milliseconds later" onClick={() => adjustOffset(offset + 250)}>+</button><button onClick={() => adjustOffset(0)}>Reset</button></div>}
    </details>
    {message && <p role="status" className="lyric-settings-message">{message}</p>}
    {loading && <div className="lyric-loading"><i /><i /><i /><span>Loading lyrics</span></div>}
    {!loading && !lyrics.length && <div className="lyrics-empty"><Icon name={query.isError ? 'wifi' : 'lyrics'} /><strong>{custom ? 'Add your lyrics above' : query.isError ? 'This lyrics source could not be reached' : 'No lyrics from this source'}</strong><span>Choose another source or paste your own lyrics in Lyrics settings.</span>{!custom && <button className="text-button" onClick={() => void query.refetch()}>Try again</button>}</div>}
    {!!lyrics.length && <div className="lyric-lines" ref={viewport} data-synced={synced ? 'true' : 'false'}>{lyrics.map((line, index) => <button type="button" data-lyric-index={index} key={`${line.time ?? 'plain'}-${index}`} className={`lyric-line ${index === currentLine && line.time !== undefined ? 'is-current' : ''} ${line.time === undefined ? 'is-plain' : ''}`} onClick={() => { if (line.time !== undefined) { seek(line.time + offset / 1000); useRoomStore.getState().broadcastPlayback('seek'); } }} aria-current={index === currentLine ? 'true' : undefined}><span>{line.text}</span>{romanized && line.romanized && <small className="romanized-lyric">{line.romanized}</small>}</button>)}</div>}
  </div>;
}
