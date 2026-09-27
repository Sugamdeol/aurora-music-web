import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDuration } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { useRoomStore } from '../room/client';
import { Artwork, IconButton } from './primitives';
import { Icon } from './Icon';
import { getSetting, setSetting } from '../lib/db';
import { Link } from 'react-router-dom';
import { EqualizerControls } from './EqualizerControls';
import { TrackActions } from './TrackActions';
import { lyricIndexAt } from '../lib/trackActions';

function PlaybackSpeed() {
  const rate = usePlaybackStore((state) => state.playbackRate);
  const together = useRoomStore((state) => state.status === 'connected');
  return <label className="playback-speed" title={together ? 'Listening rooms use normal speed to stay in sync' : 'Change playback speed'}><span>Speed</span><select aria-label="Playback speed" disabled={together} value={rate} onChange={(event) => usePlaybackStore.getState().setPlaybackRate(Number(event.target.value))}>{[.5, .75, 1, 1.25, 1.5, 1.75, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>;
}

function Progress() {
  const position = usePlaybackStore((state) => state.position);
  const duration = usePlaybackStore((state) => state.duration);
  const seek = usePlaybackStore((state) => state.seek);
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  return <div className="progress-wrap progress-large">
    <span>{formatDuration(position)}</span>
    <input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={(event) => { seek(Number(event.target.value)); useRoomStore.getState().broadcastPlayback('seek'); }} aria-label="Track progress" style={{ '--progress': `${percent}%` } as React.CSSProperties} />
    <span>{formatDuration(duration)}</span>
  </div>;
}

function PlaybackControls({ large = false }: { large?: boolean }) {
  const playing = usePlaybackStore((state) => state.isPlaying);
  const status = usePlaybackStore((state) => state.status);
  const shuffle = usePlaybackStore((state) => state.shuffle);
  const repeat = usePlaybackStore((state) => state.repeat);
  const { togglePlayback, previous, next, toggleShuffle, cycleRepeat } = usePlaybackStore.getState();
  return <div className={`playback-controls ${large ? 'playback-controls-large' : ''}`}>
    {large && <IconButton icon="shuffle" label="Toggle shuffle" active={shuffle} onClick={toggleShuffle} />}
    <IconButton icon="previous" label="Previous track" onClick={previous} />
    <button className={`main-play ${large ? 'main-play-large' : ''} ${status === 'loading' ? 'is-loading' : ''}`} onClick={togglePlayback} aria-label={playing ? 'Pause' : 'Play'}><Icon name={playing ? 'pause' : 'play'} size={large ? 28 : 21} /></button>
    <IconButton icon="next" label="Next track" onClick={() => next()} />
    {large && <IconButton icon={repeat === 'one' ? 'repeat-one' : 'repeat'} label={`Repeat ${repeat}`} active={repeat !== 'off'} onClick={cycleRepeat} />}
  </div>;
}

export function PlayerDock() {
  const track = usePlaybackStore((state) => state.currentTrack);
  const status = usePlaybackStore((state) => state.status);
  const position = usePlaybackStore((state) => state.position);
  const duration = usePlaybackStore((state) => state.duration);
  const error = usePlaybackStore((state) => state.error);
  const volume = usePlaybackStore((state) => state.volume);
  const muted = usePlaybackStore((state) => state.muted);
  const openFull = usePlaybackStore((state) => state.openFullPlayer);
  const setVolume = usePlaybackStore((state) => state.setVolume);
  const toggleMute = usePlaybackStore((state) => state.toggleMute);
  const retry = usePlaybackStore((state) => state.retrySource);
  const openSheet = usePlaybackStore((state) => state.openSheet);
  const liked = useLibraryStore((state) => Boolean(track && state.likedIds.has(track.id)));
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const consumedSwipe = useRef(false);

  if (!track) return null;
  const gestureEnd = (event: React.PointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dy < -45 && Math.abs(dy) > Math.abs(dx)) { consumedSwipe.current = true; openFull(true); }
    else if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
      consumedSwipe.current = true;
      if (dx < 0) usePlaybackStore.getState().next();
      else usePlaybackStore.getState().previous();
    }
  };
  return <aside className="player-dock glass-surface" aria-label="Now playing">
    <button className="dock-track" onClick={() => { if (consumedSwipe.current) { consumedSwipe.current = false; return; } openFull(true); }} onPointerDown={(event) => { consumedSwipe.current = false; pointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={gestureEnd} onPointerCancel={() => { pointerStart.current = null; }}>
      <Artwork src={track.artwork} title={track.title} />
      <span><strong>{track.title}</strong><small>{track.artist}</small></span>
    </button>
    <div className="dock-transport">
      <PlaybackControls />
      <div className="dock-timeline mini-progress-rail">
        <span>{formatDuration(position)}</span>
        <input className="dock-seek" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} disabled={!duration} onChange={(event) => { usePlaybackStore.getState().seek(Number(event.target.value)); useRoomStore.getState().broadcastPlayback('seek'); }} aria-label="Track progress" aria-valuetext={`${formatDuration(position)} of ${formatDuration(duration)}`} style={{ '--progress': `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` } as React.CSSProperties} />
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
    <div className="dock-actions">
      <IconButton icon="heart" label={liked ? 'Remove from liked songs' : 'Add to liked songs'} active={liked} onClick={() => void useLibraryStore.getState().toggleLike(track)} />
      <IconButton icon="lyrics" label="Open lyrics in player" onClick={() => openFull(true)} />
      <IconButton icon="queue" label="Queue" onClick={() => openSheet('queue')} />
      <IconButton icon={muted ? 'mute' : 'volume'} label={muted ? 'Unmute' : 'Mute'} onClick={toggleMute} />
      <input className="volume-slider" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" />
    </div>
    {status === 'error' && <div className="dock-error" role="alert"><span>{error}</span><button onClick={retry}>Retry</button></div>}
  </aside>;
}

function QueueSheet() {
  const queue = usePlaybackStore((state) => state.queue);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const remove = usePlaybackStore((state) => state.removeFromQueue);
  const reorder = usePlaybackStore((state) => state.reorderQueue);
  const clear = usePlaybackStore((state) => state.clearQueue);
  const clearUpcoming = usePlaybackStore((state) => state.clearUpcoming);
  const context = usePlaybackStore((state) => state.contextLabel);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('My listening queue');
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [error, setError] = useState('');
  const upcoming = queue.slice(currentIndex + 1);
  const minutes = Math.round(upcoming.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0) / 60);
  const incompleteDuration = upcoming.some((track) => !track.durationSeconds);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const playlist = await useLibraryStore.getState().createPlaylistFromTracks(name, queue);
      setSavedId(playlist.id); setSaving(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save this queue. Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="sheet-content queue-sheet">
    <div className="sheet-title"><div><span>{context}</span><h2>Your queue</h2></div></div>
    <div className="queue-overview"><Icon name="queue" /><div><strong>{upcoming.length} {upcoming.length === 1 ? 'song' : 'songs'} up next</strong><span>{minutes > 0 ? `${incompleteDuration ? 'Known duration:' : 'About'} ${minutes} minutes · ` : ''}Drag songs to change the order</span></div></div>
    <div className="queue-toolbar">{queue.length > 0 && <button className="secondary-button" onClick={() => { setSaving((value) => !value); setSavedId(''); }}><Icon name="plus" size={16} /> Save as playlist</button>}{upcoming.length > 0 && <button className="text-button" onClick={clearUpcoming}>Clear upcoming</button>}</div>
    {saving && <form className="queue-save-form" onSubmit={(event) => void save(event)}><label>Playlist name<input autoFocus value={name} maxLength={64} onChange={(event) => setName(event.target.value)} required /></label><button className="primary-button" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save queue'}</button></form>}
    {error && <p className="queue-save-message danger" role="alert">{error}</p>}
    {savedId && <p className="queue-save-message" role="status"><Icon name="check" size={16} /> Saved to your library. <Link to={`/playlist/local/${encodeURIComponent(savedId)}`} onClick={() => usePlaybackStore.getState().openSheet(null)}>Open playlist</Link></p>}
    <div className="queue-list" aria-label="Queued tracks">{queue.map((track, index) => <div key={`${track.id}-${index}`} className={`queue-item ${index === currentIndex ? 'is-current' : ''} ${index < currentIndex ? 'was-played' : ''}`} draggable onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) reorder(dragIndex, index); setDragIndex(null); }}>
      <span className="drag-handle" aria-hidden="true"><Icon name="drag" /></span><Artwork src={track.artwork} title={track.title} /><button type="button" className="plain-button" onClick={() => usePlaybackStore.getState().playTrack(track, queue, 'Queue', index)}><strong>{track.title}</strong><small>{track.recommended ? 'Suggested for you · ' : ''}{track.artist}</small></button><div className="queue-item-actions"><IconButton icon="chevron-right" label={`Move ${track.title} up`} className="queue-move queue-move-up" disabled={index === 0} onClick={() => reorder(index, index - 1)} /><IconButton icon="chevron-right" label={`Move ${track.title} down`} className="queue-move queue-move-down" disabled={index === queue.length - 1} onClick={() => reorder(index, index + 1)} /><IconButton icon="x" label={`Remove ${track.title} from queue`} onClick={() => remove(index)} /></div>
    </div>)}</div>
    {!queue.length && <p className="sheet-empty">Your queue is empty.</p>}
    {queue.length > 0 && <button className="text-button danger queue-stop" onClick={clear}>Stop playback and clear queue</button>}
  </div>;
}

function TrackLyrics({ romanized }: { romanized: boolean }) {
  const track = usePlaybackStore((state) => state.currentTrack);
  const position = usePlaybackStore((state) => state.position);
  const seek = usePlaybackStore((state) => state.seek);
  const viewport = useRef<HTMLDivElement>(null);
  const [timing, setTiming] = useState<{ id: string; offset: number }>({ id: '', offset: 0 });
  const offset = timing.id === track?.id ? timing.offset : 0;
  const [timingError, setTimingError] = useState('');
  useEffect(() => {
    let active = true;
    setTimingError('');
    if (track) void getSetting<number>(`lyrics.offset.${track.id}`, 0).then((value) => {
      if (active) setTiming({ id: track.id, offset: Number.isFinite(value) ? Math.max(-10_000, Math.min(10_000, value)) : 0 });
    }).catch(() => { if (active) { setTiming({ id: track.id, offset: 0 }); setTimingError('Saved timing could not be loaded.'); } });
    return () => { active = false; };
  }, [track?.id]);
  const adjustOffset = (value: number) => {
    if (!track) return;
    const next = Math.max(-10_000, Math.min(10_000, value));
    setTiming({ id: track.id, offset: next }); setTimingError('');
    void setSetting(`lyrics.offset.${track.id}`, next).catch(() => setTimingError('Timing changed, but could not be saved.'));
  };
  const query = useQuery({
    queryKey: ['lyrics', track?.id],
    queryFn: ({ signal }) => api.lyrics(track!, signal),
    enabled: Boolean(track && track.source !== 'local'),
    staleTime: 30 * 60_000,
    retry: 1,
  });
  const lyrics = query.data?.lines ?? [];
  useEffect(() => {
    if (!query.data?.synced || query.isError) return;
    const activeIndex = lyricIndexAt(lyrics.map((line) => line.time), position, offset);
    if (activeIndex < 0) return;
    const active = viewport.current?.querySelector<HTMLElement>(`[data-lyric-index="${activeIndex}"]`);
    if (active) {
      const view = viewport.current;
      if (view) {
        const viewRect = view.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        const relativeTop = activeRect.top - viewRect.top + view.scrollTop;
        if (activeRect.top < viewRect.top + 70 || activeRect.bottom > viewRect.bottom - 90) {
          view.scrollTo({ top: Math.max(0, relativeTop - view.clientHeight * .43), behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
        }
      }
    }
  }, [lyrics, position, offset, query.data?.synced, query.isError]);

  const currentLine = lyricIndexAt(lyrics.map((line) => line.time), position, offset);
  const loading = query.isLoading || query.isFetching;
  const error = query.isError;
  const ready = lyrics.length > 0;
  return <div className="lyrics-view lyrics-view-full">
    {loading && <div className="lyric-loading"><i /><i /><i /><span>Finding synced lyrics across Aurora sources</span></div>}
    {!loading && !ready && <div className="lyrics-empty"><Icon name={error ? 'wifi' : 'lyrics'} /><strong>{error ? 'Lyrics could not be reached' : 'No lyrics found yet'}</strong><span>{error ? 'Check your connection and try again.' : 'Aurora checked its lyric sources. Try again in a moment.'}</span><button className="text-button" onClick={() => void query.refetch()}>Try again</button></div>}
    {ready && <>
      <div className="lyrics-provider">{query.data?.synced ? 'Synced lyrics' : 'Lyrics'}{query.data?.provider && <span> · {query.data.provider}</span>}</div>
      {query.data?.synced && <div className="lyric-timing"><span>Lyric timing</span><button disabled={timing.id !== track?.id} aria-label="Show lyrics 250 milliseconds earlier" onClick={() => adjustOffset(offset - 250)}>−</button><output>{offset > 0 ? '+' : ''}{offset} ms</output><button disabled={timing.id !== track?.id} aria-label="Show lyrics 250 milliseconds later" onClick={() => adjustOffset(offset + 250)}>+</button><button className="lyric-timing-reset" disabled={timing.id !== track?.id} onClick={() => adjustOffset(0)}>Reset</button></div>}
      {timingError && <small className="danger" role="status">{timingError}</small>}
      <div className="lyric-lines" ref={viewport} data-synced={query.data?.synced ? 'true' : 'false'}>
        {lyrics.map((line, index) => <button type="button" data-lyric-index={index} key={`${line.time ?? 'plain'}-${index}`} className={`lyric-line ${index === currentLine && line.time !== undefined ? 'is-current' : ''} ${line.time === undefined ? 'is-plain' : ''}`} onClick={() => { if (line.time !== undefined) { seek(line.time + offset / 1000); useRoomStore.getState().broadcastPlayback('seek'); } }} aria-current={index === currentLine ? 'true' : undefined}><span>{line.text}</span>{romanized && line.romanized && <small className="romanized-lyric">{line.romanized}</small>}</button>)}
      </div>
    </>}
  </div>;
}

let sleepTimeout: number | undefined;
let sleepEndUnsubscribe: (() => void) | undefined;
let sleepEndsAt = 0;
function clearSleepTimer() {
  window.clearTimeout(sleepTimeout);
  sleepTimeout = undefined;
  sleepEndUnsubscribe?.();
  sleepEndUnsubscribe = undefined;
  sleepEndsAt = 0;
}
function startSleepTimer(minutes?: number) {
  clearSleepTimer();
  if (minutes) {
    sleepEndsAt = Date.now() + minutes * 60_000;
    sleepTimeout = window.setTimeout(() => { usePlaybackStore.getState().pause(); clearSleepTimer(); }, minutes * 60_000);
  } else {
    const currentId = usePlaybackStore.getState().currentTrack?.id;
    if (!currentId) return;
    sleepEndsAt = -1;
    sleepEndUnsubscribe = usePlaybackStore.subscribe((state) => {
      if (state.currentTrack?.id !== currentId) { state.pause(); clearSleepTimer(); }
    });
  }
}

function SleepSheet() {
  const [, refresh] = useState(0);
  const position = usePlaybackStore((state) => state.position);
  const duration = usePlaybackStore((state) => state.duration);
  useEffect(() => { const timer = window.setInterval(() => refresh((value) => value + 1), 1000); return () => window.clearInterval(timer); }, []);
  const active = sleepEndsAt > Date.now() || sleepEndsAt === -1;
  const remaining = sleepEndsAt > Date.now() ? Math.max(0, Math.ceil((sleepEndsAt - Date.now()) / 60_000)) : 0;
  return <div className="sheet-content sleep-sheet">
    <div className="sheet-title"><div><span>Wind down</span><h2>Sleep timer</h2></div></div>
    <p>Choose when Aurora should gently stop playback.</p>
    {active && <div className="sleep-active"><Icon name="clock" /><span>{sleepEndsAt === -1 ? 'At the end of this track' : `Pausing in about ${remaining} min`}</span><button className="text-button danger" onClick={() => { clearSleepTimer(); refresh((value) => value + 1); }}>Cancel</button></div>}
    <div className="sleep-options">{[15, 30, 45, 60].map((minutes) => <button key={minutes} onClick={() => { startSleepTimer(minutes); refresh((value) => value + 1); }}><strong>{minutes}</strong><span>minutes</span></button>)}<button className="sleep-end-track" onClick={() => { startSleepTimer(); refresh((value) => value + 1); }} disabled={!duration || position >= duration}><Icon name="music" /><span>At end of this track</span></button></div>
  </div>;
}

function FullPlayer() {
  const open = usePlaybackStore((state) => state.fullPlayerOpen);
  const track = usePlaybackStore((state) => state.currentTrack);
  const context = usePlaybackStore((state) => state.contextLabel);
  const status = usePlaybackStore((state) => state.status);
  const error = usePlaybackStore((state) => state.error);
  const activeSheet = usePlaybackStore((state) => state.activeSheet);
  const close = () => usePlaybackStore.getState().openFullPlayer(false);
  const openSheet = usePlaybackStore((state) => state.openSheet);
  const liked = useLibraryStore((state) => track ? state.likedIds.has(track.id) : false);
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const volume = usePlaybackStore((state) => state.volume);
  const setVolume = usePlaybackStore((state) => state.setVolume);
  const [lyricsVisible, setLyricsVisible] = useState(true);
  const [romanizedLyrics, setRomanizedLyrics] = useState(true);
  const queue = usePlaybackStore((state) => state.queue);
  const currentIndex = usePlaybackStore((state) => state.currentIndex);
  const shuffle = usePlaybackStore((state) => state.shuffle);
  const nextTrack = shuffle ? undefined : queue[currentIndex + 1];

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') activeSheet ? openSheet(null) : close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeSheet]);
  useEffect(() => {
    if (!open) return;
    void Promise.all([getSetting('player.lyrics.enabled', true), getSetting('player.lyrics.romanized', true)]).then(([enabled, romanized]) => { setLyricsVisible(enabled); setRomanizedLyrics(romanized); });
  }, [open]);
  if (!open || !track) return null;
  return <div className="full-player" role="dialog" aria-modal="true" aria-label={`Now playing ${track.title}`}>
    <div className="player-ambient" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '%22')}")` } : undefined} />
    <header className="full-player-top"><IconButton icon="chevron-down" label="Close full player" onClick={close} /><span>Playing from <strong>{context}</strong></span><div className="full-player-top-actions"><IconButton icon="lyrics" label={lyricsVisible ? 'Hide lyrics' : 'Show lyrics'} active={lyricsVisible} onClick={() => { const next = !lyricsVisible; setLyricsVisible(next); void setSetting('player.lyrics.enabled', next); }} /><IconButton icon="queue" label="Open queue" onClick={() => openSheet('queue')} /></div></header>
    <div className={`full-player-body ${lyricsVisible ? '' : 'lyrics-hidden'}`}>
      <section className="full-player-media" aria-label="Playback controls">
        <Artwork className="full-artwork" src={track.artwork} title={track.title} />
        <div className="full-track-copy"><div><h1>{track.title}</h1><p>{track.artist}{track.album ? <span>{track.album}</span> : null}</p></div><IconButton icon="heart" label={liked ? 'Unlike track' : 'Like track'} active={liked} onClick={() => void toggleLike(track)} /></div>
        <Progress />
        <PlaybackControls large />
        <div className="player-tools"><PlaybackSpeed /><div className="seek-buttons"><button onClick={() => { const player = usePlaybackStore.getState(); player.seek(player.position - 10); useRoomStore.getState().broadcastPlayback('seek'); }} aria-label="Rewind ten seconds">−10s</button><button onClick={() => { const player = usePlaybackStore.getState(); player.seek(player.position + 10); useRoomStore.getState().broadcastPlayback('seek'); }} aria-label="Forward ten seconds">+10s</button></div></div>
        <div className="full-player-actions">
          <button onClick={() => openSheet('queue')}><Icon name="queue" /><span>Queue</span></button>
          <button onClick={() => openSheet('sleep')}><Icon name="clock" /><span>Sleep</span></button>
          <button onClick={() => openSheet('equalizer')}><Icon name="sliders" /><span>Sound</span></button>
          <label><Icon name="volume" /><input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="Volume" /></label>
        </div>
        <TrackActions track={track} />
        {nextTrack && <button className="next-track-card" onClick={() => openSheet('queue')}><Artwork src={nextTrack.artwork} title={nextTrack.title} /><span><small>{nextTrack.recommended ? 'Suggested next' : 'Up next'}</small><strong>{nextTrack.title}</strong><span>{nextTrack.artist}</span></span><Icon name="queue" /></button>}
        <p className="player-keyboard-hint">Space to play · ← / → seek 10s · Shift + arrows change song · M to mute</p>
        {status === 'error' && <div className="player-error" role="alert">{error}<button onClick={() => usePlaybackStore.getState().retrySource()}>Retry</button></div>}
      </section>
      {lyricsVisible && <section className="full-player-lyrics" aria-label="Synced lyrics"><header><div><span>LIVE LYRICS</span><h2>Sing along</h2><p>{track.artist}</p></div><button className={`romanization-toggle ${romanizedLyrics ? 'is-active' : ''}`} aria-pressed={romanizedLyrics} onClick={() => { const next = !romanizedLyrics; setRomanizedLyrics(next); void setSetting('player.lyrics.romanized', next); }}><Icon name="lyrics" size={15} /><span>{romanizedLyrics ? 'Romanized on' : 'Romanize'}</span></button></header><TrackLyrics romanized={romanizedLyrics} /></section>}
    </div>
  </div>;
}

function DetailSheet() {
  const active = usePlaybackStore((state) => state.activeSheet);
  const close = () => usePlaybackStore.getState().openSheet(null);
  if (!active) return null;
  return <div className="detail-sheet" role="dialog" aria-modal="true" aria-label={active === 'queue' ? 'Playback queue' : active === 'equalizer' ? 'Equalizer' : 'Sleep timer'}>
    <button className="sheet-backdrop" onClick={close} aria-label="Close panel" />
    <div className="sheet-panel glass-surface"><span className="sheet-grabber" /><IconButton icon="x" label="Close panel" className="sheet-close" onClick={close} />{active === 'queue' ? <QueueSheet /> : active === 'equalizer' ? <div className="sheet-content"><div className="sheet-title"><div><span>Fine tune your sound</span><h2>Equalizer</h2></div></div><EqualizerControls /></div> : <SleepSheet />}</div>
  </div>;
}

export function PlayerOverlays() { return <><FullPlayer /><DetailSheet /></>; }
