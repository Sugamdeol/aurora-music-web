import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { formatDuration } from '../domain/media';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { useRoomStore } from '../room/client';
import { Artwork, IconButton, Marquee } from './primitives';
import { Icon } from './Icon';
import { getSetting, setSetting } from '../lib/db';
import { Link } from 'react-router-dom';
import { EqualizerControls } from './EqualizerControls';
import { TrackActions } from './TrackActions';
import { lyricIndexAt } from '../lib/trackActions';
import { useDialog } from '../hooks/useDialog';

// Where the dock artwork sat when the full player was opened — the artwork
// "grows" from this spot (FLIP) instead of just fading in.
let dockArtworkOrigin: DOMRect | undefined;
function captureDockArtworkOrigin(): void {
  dockArtworkOrigin = document.querySelector('.player-dock .artwork')?.getBoundingClientRect();
}

function PlaybackSpeed() {
  const rate = usePlaybackStore((state) => state.playbackRate);
  const together = useRoomStore((state) => state.status === 'connected');
  return <label className="playback-speed" title={together ? 'Listening rooms use normal speed to stay in sync' : 'Change playback speed'}><span>Speed</span><select aria-label="Playback speed" disabled={together} value={rate} onChange={(event) => usePlaybackStore.getState().setPlaybackRate(Number(event.target.value))}>{[.5, .75, 1, 1.25, 1.5, 1.75, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>;
}

// Room guests need seek updates, but a dragged slider emits an input event per
// frame — dozens of WebSocket messages a second that rubber-band every guest.
// Leading + 320 ms trailing keeps the room in sync without the flood.
let lastSeekBroadcastAt = 0;
let seekBroadcastTimer: number | undefined;
function broadcastSeek(): void {
  const now = Date.now();
  if (now - lastSeekBroadcastAt >= 300) {
    lastSeekBroadcastAt = now;
    useRoomStore.getState().broadcastPlayback('seek');
    return;
  }
  window.clearTimeout(seekBroadcastTimer);
  seekBroadcastTimer = window.setTimeout(() => {
    lastSeekBroadcastAt = Date.now();
    useRoomStore.getState().broadcastPlayback('seek');
  }, 320);
}

function BufferStatus() {
  const track = usePlaybackStore((state) => state.currentTrack);
  const status = usePlaybackStore((state) => state.status);
  const duration = usePlaybackStore((state) => state.duration);
  const buffered = usePlaybackStore((state) => state.buffered);
  const nextReady = usePlaybackStore((state) => state.nextReady);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (status !== 'loading') return;
    const timer = window.setTimeout(() => setSlow(true), 12000);
    return () => window.clearTimeout(timer);
  }, [status, track?.id]);
  const loaded = duration > 0 ? Math.min(100, Math.floor(buffered / duration * 100)) : 0;
  return <div className="buffer-status">
    <span>{status === 'loading' ? (slow ? 'Taking a little longer…' : 'Getting your song ready…') : `${loaded}% buffered${nextReady ? ' · Next song ready' : ''}`}</span>
    {slow && status === 'loading' && <button onClick={() => usePlaybackStore.getState().retrySource()}>Retry</button>}
  </div>;
}

function Progress() {
  const position = usePlaybackStore((state) => state.position);
  const duration = usePlaybackStore((state) => state.duration);
  const buffered = usePlaybackStore((state) => state.buffered);
  const seek = usePlaybackStore((state) => state.seek);
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const bufferedPercent = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  return <div className="timeline-detail"><div className="progress-wrap progress-large">
    <span>{formatDuration(position)}</span>
    <span className="seek-track" style={{ '--buffered': `${bufferedPercent}%` } as React.CSSProperties}>
      <i className="buffer-spine" style={{ '--buffered': `${bufferedPercent}%` } as React.CSSProperties} aria-hidden="true" />
      <input type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} onChange={(event) => { seek(Number(event.target.value)); broadcastSeek(); }} aria-label="Track progress" style={{ '--progress': `${percent}%` } as React.CSSProperties} />
    </span>
    <span>{formatDuration(duration)}</span>
  </div><BufferStatus /></div>;
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
  const buffered = usePlaybackStore((state) => state.buffered);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const consumedSwipe = useRef(false);

  if (!track) return null;
  const gestureEnd = (event: React.PointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dy < -45 && Math.abs(dy) > Math.abs(dx)) { consumedSwipe.current = true; captureDockArtworkOrigin(); openFull(true); }
    else if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) {
      consumedSwipe.current = true;
      if (dx < 0) usePlaybackStore.getState().next();
      else usePlaybackStore.getState().previous();
    }
  };
  return <aside className="player-dock glass-surface" aria-label="Now playing">
    <button className="dock-track" onClick={() => { if (consumedSwipe.current) { consumedSwipe.current = false; return; } captureDockArtworkOrigin(); openFull(true); }} onPointerDown={(event) => { consumedSwipe.current = false; pointerStart.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={gestureEnd} onPointerCancel={() => { pointerStart.current = null; }}>
      <Artwork src={track.artwork} title={track.title} />
      <span><strong><Marquee text={track.title} /></strong><small>{track.artist}</small></span>
    </button>
    <div className="dock-transport">
      <PlaybackControls />
      <div className="dock-timeline">
        <span>{formatDuration(position)}</span>
        <span className="seek-track" style={{ '--buffered': `${duration > 0 ? Math.min(100, buffered / duration * 100) : 0}%` } as React.CSSProperties}>
          <i className="buffer-spine" style={{ '--buffered': `${duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0}%` } as React.CSSProperties} aria-hidden="true" />
          <input className="dock-seek" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(position, duration || 1)} disabled={!duration} onChange={(event) => { usePlaybackStore.getState().seek(Number(event.target.value)); broadcastSeek(); }} aria-label="Track progress" aria-valuetext={`${formatDuration(position)} of ${formatDuration(duration)}`} style={{ '--progress': `${duration > 0 ? Math.min(100, (position / duration) * 100) : 0}%` } as React.CSSProperties} />
        </span>
        <span>{formatDuration(duration)}</span>
      </div>
      <BufferStatus />
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
  const [filter, setFilter] = useState('');
  const upcoming = queue.slice(currentIndex + 1);
  const visibleQueue = queue.map((track, index) => ({ track, index })).filter(({ track }) => `${track.title} ${track.artist}`.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
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
    {queue.length > 6 && <label className="queue-filter"><Icon name="search" size={17} /><input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Find in queue" aria-label="Find in queue" /></label>}
    <div className="queue-list" aria-label="Queued tracks">{visibleQueue.map(({ track, index }) => <div key={`${track.id}-${index}`} className={`queue-item ${index === currentIndex ? 'is-current' : ''} ${index < currentIndex ? 'was-played' : ''}`} draggable={!filter} onDragStart={() => setDragIndex(index)} onDragEnd={() => setDragIndex(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndex !== null) reorder(dragIndex, index); setDragIndex(null); }}>
      <span className="drag-handle" aria-hidden="true"><Icon name="drag" /></span><Artwork src={track.artwork} title={track.title} /><button type="button" className="plain-button" onClick={() => usePlaybackStore.getState().playTrack(track, queue, 'Queue', index)}><strong>{track.title}</strong><small>{track.recommended ? 'Suggested for you · ' : ''}{track.artist}</small></button><div className="queue-item-actions"><IconButton icon="chevron-right" label={`Move ${track.title} up`} className="queue-move queue-move-up" disabled={index === 0} onClick={() => reorder(index, index - 1)} /><IconButton icon="chevron-right" label={`Move ${track.title} down`} className="queue-move queue-move-down" disabled={index === queue.length - 1} onClick={() => reorder(index, index + 1)} /><IconButton icon="x" label={`Remove ${track.title} from queue`} onClick={() => remove(index)} /></div>
    </div>)}</div>
    {filter && !visibleQueue.length && <p className="sheet-empty">No songs match “{filter}”.</p>}
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
  const lyricTimes = useMemo(() => lyrics.map((line) => line.time), [lyrics]);
  const currentLine = lyricIndexAt(lyricTimes, position, offset);
  useEffect(() => {
    if (!query.data?.synced || query.isError) return;
    if (currentLine < 0) return;
    const active = viewport.current?.querySelector<HTMLElement>(`[data-lyric-index="${currentLine}"]`);
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
  }, [lyrics, currentLine, query.data?.synced, query.isError]);

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
        {lyrics.map((line, index) => <button type="button" data-lyric-index={index} key={`${line.time ?? 'plain'}-${index}`} className={`lyric-line ${index === currentLine && line.time !== undefined ? 'is-current' : ''} ${line.time === undefined ? 'is-plain' : ''}`} onClick={() => { if (line.time !== undefined) { seek(line.time + offset / 1000); broadcastSeek(); } }} aria-current={index === currentLine ? 'true' : undefined}><span>{line.text}</span>{romanized && line.romanized && <small className="romanized-lyric">{line.romanized}</small>}</button>)}
      </div>
    </>}
  </div>;
}

let sleepWatcher: number | undefined;
let sleepEndUnsubscribe: (() => void) | undefined;
let sleepEndsAt = 0;
function clearSleepTimer() {
  window.clearInterval(sleepWatcher);
  sleepWatcher = undefined;
  sleepEndUnsubscribe?.();
  sleepEndUnsubscribe = undefined;
  sleepEndsAt = 0;
}
function startSleepTimer(minutes?: number) {
  clearSleepTimer();
  if (minutes) {
    sleepEndsAt = Date.now() + minutes * 60_000;
    // A single long setTimeout gets indefinitely throttled in frozen/background
    // tabs — exactly the state a sleep timer runs in. Poll the wall clock
    // instead so the pause lands shortly after the deadline, even on wake.
    sleepWatcher = window.setInterval(() => {
      if (Date.now() >= sleepEndsAt) { usePlaybackStore.getState().pause(); clearSleepTimer(); }
    }, 15_000);
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
  const [customMinutes, setCustomMinutes] = useState('10');
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
    <form className="sleep-custom" onSubmit={(event) => { event.preventDefault(); const minutes = Number(customMinutes); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return; startSleepTimer(minutes); refresh((value) => value + 1); }}><label htmlFor="sleep-custom-minutes">Custom timer</label><input id="sleep-custom-minutes" type="number" min="1" max="240" step="1" inputMode="numeric" value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} /><span>min</span><button className="secondary-button" type="submit">Set timer</button></form>
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
  // Escape peels one layer at a time: an open sheet first, then the player.
  // (The player's listener registers before DetailSheet's, so it must decide.)
  const dialogRef = useDialog<HTMLDivElement>(open && Boolean(track), () => {
    const player = usePlaybackStore.getState();
    if (player.activeSheet) player.openSheet(null);
    else close();
  });
  const artworkWrapRef = useRef<HTMLDivElement>(null);
  const swipeDrag = useRef<{ startY: number; lastDy: number } | null>(null);

  // Artwork grows out of the dock (FLIP) instead of materializing in place.
  useLayoutEffect(() => {
    if (!open) return;
    const origin = dockArtworkOrigin;
    dockArtworkOrigin = undefined;
    const target = artworkWrapRef.current;
    if (!origin || !target || document.documentElement.classList.contains('reduce-motion')) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width) return;
    const dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2);
    const dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2);
    const scale = origin.width / rect.width;
    if (Math.abs(dx) + Math.abs(dy) < 24) return;
    void target.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: .6 }, { transform: 'none', opacity: 1 }],
      { duration: 340, easing: 'cubic-bezier(.32,.72,.28,1)' },
    );
  }, [open, track?.id]);
  useEffect(() => {
    if (!open) return;
    void Promise.all([getSetting('player.lyrics.enabled', true), getSetting('player.lyrics.romanized', true)]).then(([enabled, romanized]) => { setLyricsVisible(enabled); setRomanizedLyrics(romanized); });
  }, [open]);
  if (!open || !track) return null;
  const swipeDown = {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse') return;
      swipeDrag.current = { startY: event.clientY, lastDy: 0 };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const drag = swipeDrag.current;
      const sheet = dialogRef.current;
      if (!drag || !sheet) return;
      const dy = Math.max(0, event.clientY - drag.startY);
      drag.lastDy = dy;
      sheet.style.transform = `translateY(${dy}px)`;
      sheet.style.opacity = String(Math.max(0.35, 1 - dy / 480));
    },
    onPointerUp: () => {
      const drag = swipeDrag.current;
      const sheet = dialogRef.current;
      swipeDrag.current = null;
      if (!drag || !sheet) return;
      if (drag.lastDy > 110) { close(); return; }
      sheet.style.transition = 'transform .28s cubic-bezier(.32,.72,.28,1), opacity .28s';
      sheet.style.transform = '';
      sheet.style.opacity = '';
      window.setTimeout(() => { if (sheet) sheet.style.transition = ''; }, 300);
    },
    onPointerCancel: () => {
      const sheet = dialogRef.current;
      swipeDrag.current = null;
      if (sheet) { sheet.style.transform = ''; sheet.style.opacity = ''; }
    },
  };
  return <div className="full-player" ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Now playing ${track.title}`} tabIndex={-1}>
    <div className="player-ambient" style={track.artwork ? { backgroundImage: `url("${track.artwork.replace(/"/g, '%22')}")` } : undefined} />
    <header className="full-player-top" {...swipeDown}><IconButton icon="chevron-down" label="Close full player" onClick={close} /><span>Playing from <strong>{context}</strong></span><div className="full-player-top-actions"><IconButton icon="lyrics" label={lyricsVisible ? 'Hide lyrics' : 'Show lyrics'} active={lyricsVisible} onClick={() => { const next = !lyricsVisible; setLyricsVisible(next); void setSetting('player.lyrics.enabled', next); }} /><IconButton icon="queue" label="Open queue" onClick={() => openSheet('queue')} /></div></header>
    <div className={`full-player-body ${lyricsVisible ? '' : 'lyrics-hidden'}`}>
      <section className="full-player-media" aria-label="Playback controls">
        <div className="full-artwork-wrap" ref={artworkWrapRef}><Artwork className="full-artwork" src={track.artwork} title={track.title} /></div>
        <div className="full-track-copy"><div><h1><Marquee text={track.title} /></h1><p>{track.artist}{track.album ? <span>{track.album}</span> : null}</p></div><IconButton icon="heart" label={liked ? 'Unlike track' : 'Like track'} active={liked} onClick={() => void toggleLike(track)} /></div>
        <Progress />
        <PlaybackControls large />
        <div className="player-tools"><PlaybackSpeed /><div className="seek-buttons"><button onClick={() => { const player = usePlaybackStore.getState(); player.seek(player.position - 10); broadcastSeek(); }} aria-label="Rewind ten seconds">−10s</button><button onClick={() => { const player = usePlaybackStore.getState(); player.seek(player.position + 10); broadcastSeek(); }} aria-label="Forward ten seconds">+10s</button></div></div>
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
  const sheetRef = useDialog<HTMLDivElement>(Boolean(active), close);
  if (!active) return null;
  return <div className="detail-sheet" ref={sheetRef} role="dialog" aria-modal="true" aria-label={active === 'queue' ? 'Playback queue' : active === 'equalizer' ? 'Equalizer' : 'Sleep timer'} tabIndex={-1}>
    <button className="sheet-backdrop" onClick={close} aria-label="Close panel" />
    <div className="sheet-panel glass-surface"><span className="sheet-grabber" /><IconButton icon="x" label="Close panel" className="sheet-close" onClick={close} />{active === 'queue' ? <QueueSheet /> : active === 'equalizer' ? <div className="sheet-content"><div className="sheet-title"><div><span>Fine tune your sound</span><h2>Equalizer</h2></div></div><EqualizerControls /></div> : <SleepSheet />}</div>
  </div>;
}

export function PlayerOverlays() { return <><FullPlayer /><DetailSheet /></>; }
