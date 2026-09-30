import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from 'react';
import type { MediaTrack } from '../domain/media';
import { formatDuration } from '../domain/media';
import { Artwork } from '../components/primitives';
import { Icon } from '../components/Icon';
import { playbackEngine } from '../lib/playbackEngine';
import {
  readCustomSpatialPresets,
  readSpatialAudioSettings,
  saveCustomSpatialPresets,
  saveSpatialAudioSettings,
  spatialMotionAtPhase,
  SPATIAL_PRESETS,
  type SpatialAudioSettings,
  type SpatialPreset,
} from '../lib/spatialAudio';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import './AudioStudio.css';

const motionOptions: Array<[SpatialAudioSettings['motion'], string, string]> = [
  ['orbit', 'Orbit', 'Left to right'],
  ['figure-eight', 'Figure eight', 'Crossing loop'],
  ['sway', 'Sway', 'Gentle drift'],
  ['manual', 'Manual', 'You steer'],
];

export function AudioStudio() {
  const currentTrack = usePlaybackStore((state) => state.currentTrack);
  const playing = usePlaybackStore((state) => state.isPlaying);
  const status = usePlaybackStore((state) => state.status);
  const position = usePlaybackStore((state) => state.position);
  const duration = usePlaybackStore((state) => state.duration);
  const localTracks = useLibraryStore((state) => state.localTracks);
  const importFiles = useLibraryStore((state) => state.importFiles);
  const reduceMotion = useLibraryStore((state) => state.appearance.reduceMotion);
  const [settings, setSettings] = useState<SpatialAudioSettings>(() => readSpatialAudioSettings());
  const [customPresets, setCustomPresets] = useState<SpatialPreset[]>(() => readCustomSpatialPresets());
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [importing, setImporting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const [livePan, setLivePan] = useState(0);
  const [systemReduceMotion, setSystemReduceMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const pointerHeld = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const recordingTrackName = useRef('aurora-spatial-mix');
  const reduceVisualMotion = reduceMotion || systemReduceMotion;

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const updatePreference = () => setSystemReduceMotion(query.matches);
    updatePreference();
    query.addEventListener?.('change', updatePreference);
    return () => query.removeEventListener?.('change', updatePreference);
  }, []);

  useEffect(() => {
    playbackEngine.setSpatialAudioSettings(settings);
    saveSpatialAudioSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!settings.enabled || settings.motion === 'manual' || !playing || reduceVisualMotion) {
      const restingPan = settings.enabled && settings.motion === 'manual' ? settings.pan / 100 : 0;
      setLivePan(restingPan);
      fieldRef.current?.style.setProperty('--sound-x', `${50 + restingPan * 35}%`);
      fieldRef.current?.style.setProperty('--sound-y', '50%');
      return;
    }
    const startedAt = performance.now();
    let frame = 0;
    let lastReadout = 0;
    const animate = (now: number) => {
      const phase = ((now - startedAt) / 1000) * settings.speed * Math.PI * 2;
      const path = spatialMotionAtPhase(settings, phase);
      const pan = path.pan;
      fieldRef.current?.style.setProperty('--sound-x', `${50 + path.x * 35}%`);
      fieldRef.current?.style.setProperty('--sound-y', `${50 + path.y * 31}%`);
      if (now - lastReadout > 120) {
        setLivePan(pan);
        lastReadout = now;
      }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [settings.enabled, settings.motion, settings.speed, settings.depth, settings.pan, playing, reduceVisualMotion]);

  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const update = (patch: Partial<SpatialAudioSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setNotice('');
  };

  const selectPreset = (preset: SpatialPreset) => {
    setSettings({ ...preset.settings, enabled: true });
    setNotice(`${preset.name} is ready`);
  };

  const importAudio = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    setNotice('');
    try {
      const tracks = await importFiles(files);
      if (tracks[0]) usePlaybackStore.getState().playTrack(tracks[0], tracks, 'Audio Studio', 0);
      if (!tracks.length) setNotice('Choose an MP3, WAV, FLAC, M4A, OGG, or WebM audio file.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'This audio could not be added.');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => void importAudio(Array.from(event.target.files ?? []));
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    void importAudio(Array.from(event.dataTransfer.files));
  };

  const steerField = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = fieldRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const raw = (event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width * 0.35);
    const pan = Math.round(Math.min(1, Math.max(-1, raw)) * 100);
    setSettings((current) => ({ ...current, enabled: true, motion: 'manual', pan }));
  };

  const savePreset = () => {
    const name = presetName.trim().slice(0, 32);
    if (!name) return;
    const saved: SpatialPreset = {
      id: globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}`,
      name,
      note: 'Your saved mix',
      settings: { motion: settings.motion, speed: settings.speed, depth: settings.depth, width: settings.width, reverb: settings.reverb, pan: settings.pan },
    };
    const next = [saved, ...customPresets].slice(0, 8);
    setCustomPresets(next);
    saveCustomSpatialPresets(next);
    setPresetName('');
    setSavingPreset(false);
    setNotice(`Saved “${name}” on this device`);
  };

  const removeCustomPreset = (id: string) => {
    const next = customPresets.filter((preset) => preset.id !== id);
    setCustomPresets(next);
    saveCustomSpatialPresets(next);
  };

  const recordProcessedAudio = () => {
    const active = recorderRef.current;
    if (active && active.state !== 'inactive') {
      active.stop();
      return;
    }
    if (!currentTrack || !playing) {
      setNotice('Start playback before recording a processed mix.');
      return;
    }
    if (!('MediaRecorder' in window)) {
      setNotice('Audio recording is not supported in this browser.');
      return;
    }
    const stream = playbackEngine.createProcessedMediaStream();
    if (!stream) {
      setNotice('The audio output could not be opened for recording.');
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
    try {
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunks.current = [];
      recordingTrackName.current = currentTrack.title;
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunks.current, { type: recorder.mimeType || 'audio/webm' });
        playbackEngine.releaseProcessedMediaStream();
        if (blob.size) {
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `${recordingTrackName.current.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'aurora-mix'}-spatial.webm`;
          anchor.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
          setNotice('Your processed mix was downloaded.');
        }
        recorderRef.current = null;
        setRecording(false);
      };
      recorder.onerror = () => {
        playbackEngine.releaseProcessedMediaStream();
        recorderRef.current = null;
        setRecording(false);
        setNotice('The recording stopped because the browser could not capture audio.');
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
      setNotice('Recording the live mix. Stop when you have the part you want.');
    } catch {
      playbackEngine.releaseProcessedMediaStream();
      setNotice('The browser could not start an audio recording.');
    }
  };

  const shownPan = Math.round(livePan * 100);
  const playedDuration = duration || currentTrack?.durationSeconds || 0;
  const progress = playedDuration ? Math.min(100, Math.max(0, (position / playedDuration) * 100)) : 0;
  const autoMotionLive = settings.enabled && settings.motion !== 'manual' && playing;
  const panLabel = autoMotionLive && reduceVisualMotion ? 'Motion active' : shownPan < -2 ? `${Math.abs(shownPan)}% left` : shownPan > 2 ? `${shownPan}% right` : 'Center';

  return <div
    className={`page spatial-page ${dragging ? 'is-dragging-audio' : ''}`}
    onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
    onDrop={handleDrop}
  >
    <input ref={fileInputRef} className="spatial-file-input" type="file" accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus,.webm" multiple onChange={handleFileChange} />
    <header className="spatial-page-head">
      <div>
        <div className="spatial-kicker"><Icon name="spatial" size={15} /> AURORA / SOUND DESIGN</div>
        <h1>Make every track <em>move.</em></h1>
        <p>Give your music a room, a path, and a little more space.</p>
      </div>
      <div className="spatial-engine-badge"><span className="spatial-engine-light" /><div><small>SPATIAL ENGINE</small><strong>Live in your browser</strong></div></div>
    </header>

    {dragging && <div className="spatial-drop-hint"><Icon name="upload" size={21} /> Drop audio to add it to Aurora</div>}

    <div className="spatial-studio-grid">
      <section className="spatial-field-card glass-surface" aria-label="Spatial audio preview">
        <div className="spatial-field-top"><div><span>LISTENING FIELD</span><strong>{settings.enabled ? 'Motion is live' : 'Sound is centered'}</strong></div><span className={`spatial-output-pill ${playing ? 'is-playing' : ''}`}><i />{playing ? 'PLAYING' : status === 'loading' ? 'LOADING' : 'READY'}</span></div>
        <div
          className={`spatial-field ${settings.enabled ? 'is-active' : ''} ${settings.motion === 'figure-eight' ? 'is-figure-eight' : ''}`}
          ref={fieldRef}
          onPointerDown={(event) => { pointerHeld.current = true; event.currentTarget.setPointerCapture(event.pointerId); steerField(event); }}
          onPointerMove={(event) => { if (pointerHeld.current) steerField(event); }}
          onPointerUp={() => { pointerHeld.current = false; }}
          onPointerCancel={() => { pointerHeld.current = false; }}
          role="slider"
          aria-label="Drag to position the sound from left to right"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={shownPan}
          aria-valuetext={shownPan < -2 ? `${Math.abs(shownPan)} percent left` : shownPan > 2 ? `${shownPan} percent right` : 'Centered'}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              update({ enabled: true, motion: 'manual', pan: Math.max(-100, Math.min(100, settings.pan + (event.key === 'ArrowLeft' ? -5 : 5))) });
            }
          }}
        >
          <div className="spatial-field-glow" />
          <div className="spatial-grid-lines" />
          <div className="spatial-ring spatial-ring-outer" />
          <div className="spatial-ring spatial-ring-middle" />
          <div className="spatial-ring spatial-ring-inner" />
          <div className="spatial-crosshair spatial-crosshair-horizontal" />
          <div className="spatial-crosshair spatial-crosshair-vertical" />
          <div className="spatial-record-orbit"><i /></div>
          <div className="spatial-center-art"><Artwork src={currentTrack?.artwork} title={currentTrack?.title ?? 'Aurora'} /></div>
          <span className="spatial-node" aria-hidden="true"><i /></span>
          <span className="spatial-field-label spatial-field-left">LEFT</span>
          <span className="spatial-field-label spatial-field-right">RIGHT</span>
          <span className="spatial-axis-label">DRAG THE DOT TO STEER</span>
        </div>
        <div className="spatial-pan-readout"><span>{autoMotionLive ? 'MOVING SOUND' : 'PAN POSITION'}</span><strong>{panLabel}</strong><span className="spatial-pan-meter"><i style={{ left: `${50 + shownPan * 0.45}%` }} /></span></div>

        <div className="spatial-track-card">
          {currentTrack ? <>
            <Artwork src={currentTrack.artwork} title={currentTrack.title} />
            <div className="spatial-track-meta"><span>{currentTrack.source === 'local' ? 'ON THIS DEVICE' : 'NOW IN AURORA'}</span><strong title={currentTrack.title}>{currentTrack.title}</strong><small>{currentTrack.artist}</small></div>
            <button className="spatial-track-add" onClick={() => fileInputRef.current?.click()} disabled={importing}><Icon name="plus" size={15} />Add</button>
            <button className="spatial-track-play" aria-label={playing ? 'Pause track' : 'Play track'} onClick={() => usePlaybackStore.getState().togglePlayback()}><Icon name={playing ? 'pause' : 'play'} size={18} /></button>
          </> : <>
            <div className="spatial-track-empty-icon"><Icon name="music" size={19} /></div>
            <div className="spatial-track-meta"><span>YOUR NEXT MIX</span><strong>Add a track to begin</strong><small>Drop audio here or choose a local file.</small></div>
            <button className="spatial-track-add" onClick={() => fileInputRef.current?.click()} disabled={importing}><Icon name="plus" size={16} />{importing ? 'Adding…' : 'Add audio'}</button>
          </>}
        </div>
        {currentTrack && playedDuration > 0 && <div className="spatial-track-progress" aria-label="Playback progress"><span style={{ width: `${progress}%` }} /><small>{formatDuration(position)} <i>/</i> {formatDuration(playedDuration)}</small></div>}
        {!currentTrack && localTracks.length > 0 && <div className="spatial-local-picks"><span>LOCAL TRACKS</span>{localTracks.slice(0, 3).map((track, index) => <LocalTrack key={track.id} track={track} index={index} tracks={localTracks} />)}</div>}
        {notice && <p className="spatial-notice" role="status">{notice}</p>}
      </section>

      <section className="spatial-controls-card glass-surface" aria-label="Spatial sound controls">
        <div className="spatial-controls-head"><div><span>YOUR SOUND</span><h2>Shape the space</h2><p>Every change reaches the player instantly.</p></div><button className={`spatial-toggle ${settings.enabled ? 'is-on' : ''}`} role="switch" aria-checked={settings.enabled} onClick={() => update({ enabled: !settings.enabled })} aria-label="Enable 8D audio"><i /></button></div>

        <div className={`spatial-control-body ${settings.enabled ? '' : 'is-muted'}`}>
          <div className="spatial-control-section">
            <div className="spatial-control-section-head"><span>Sound path</span><small>{settings.motion === 'manual' ? 'Your hand on the wheel' : 'A continuous left-right sweep'}</small></div>
            <div className="spatial-motion-options" role="group" aria-label="Sound movement path">
              {motionOptions.map(([value, label, description]) => <button key={value} className={settings.motion === value ? 'is-selected' : ''} onClick={() => update({ motion: value })} aria-pressed={settings.motion === value}><span className={`spatial-motion-glyph path-${value}`}><i /></span><strong>{label}</strong><small>{description}</small></button>)}
            </div>
          </div>

          {settings.motion === 'manual' ? <RangeControl label="Position" value={`${settings.pan > 0 ? '+' : ''}${settings.pan}%`} min={-100} max={100} step={1} valueNumber={settings.pan} disabled={!settings.enabled} onChange={(pan) => update({ pan })} left="Left" right="Right" /> : <RangeControl label="Movement speed" value={`${(1 / settings.speed).toFixed(0)} sec / loop`} min={0.03} max={0.24} step={0.01} valueNumber={settings.speed} disabled={!settings.enabled} onChange={(speed) => update({ speed })} left="Slow" right="Quick" />}
          <RangeControl label="Travel depth" value={`${settings.depth}%`} min={0} max={100} step={1} valueNumber={settings.depth} disabled={!settings.enabled} onChange={(depth) => update({ depth })} left="Close" right="Full sweep" />

          <div className="spatial-control-section spatial-room-section">
            <div className="spatial-control-section-head"><span>Room & stereo</span><small>Fine tune the edges</small></div>
            <RangeControl label="Stereo width" value={`${settings.width}%`} min={60} max={150} step={1} valueNumber={settings.width} disabled={!settings.enabled} onChange={(width) => update({ width })} left="Focused" right="Wide" />
            <RangeControl label="Room reverb" value={`${settings.reverb}%`} min={0} max={45} step={1} valueNumber={settings.reverb} disabled={!settings.enabled} onChange={(reverb) => update({ reverb })} left="Dry" right="Dreamy" />
          </div>
        </div>

        <div className="spatial-control-foot"><span className="spatial-headphone-icon"><Icon name="radio" size={16} /></span><p>Headphones bring out the left-right motion. Spatial effects stay with your music across Aurora.</p></div>
      </section>
    </div>

    <section className="spatial-presets-section">
      <header className="spatial-presets-head"><div><span>START WITH A FEELING</span><h2>Sound recipes</h2></div><button className="spatial-save-preset" onClick={() => { setSavingPreset((value) => !value); setNotice(''); }}><Icon name="plus" size={15} /> Save this mix</button></header>
      {savingPreset && <form className="spatial-save-form" onSubmit={(event) => { event.preventDefault(); savePreset(); }}><label htmlFor="spatial-preset-name">Name your mix</label><input id="spatial-preset-name" autoFocus maxLength={32} value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="e.g. Late night drive" /><button className="primary-button" type="submit" disabled={!presetName.trim()}>Save</button><button className="text-button" type="button" onClick={() => setSavingPreset(false)}>Cancel</button></form>}
      <div className="spatial-preset-grid">
        {SPATIAL_PRESETS.map((preset, index) => <PresetCard key={preset.id} preset={preset} index={index} onClick={() => selectPreset(preset)} />)}
        {customPresets.map((preset, index) => <PresetCard key={preset.id} preset={preset} index={index + SPATIAL_PRESETS.length} custom onClick={() => selectPreset(preset)} onRemove={() => removeCustomPreset(preset.id)} />)}
      </div>
    </section>

    <footer className="spatial-studio-footer"><span><Icon name="spatial" size={15} /> Aurora spatial audio</span><p>Choose a track, turn on 8D, and shape the room. Your mix is processed locally.</p><button className={`spatial-record-button ${recording ? 'is-recording' : ''}`} onClick={recordProcessedAudio}><Icon name={recording ? 'stop' : 'download'} size={16} />{recording ? 'Stop & download' : 'Record processed mix'}</button></footer>
  </div>;
}

function RangeControl({ label, value, valueNumber, min, max, step, disabled, left, right, onChange }: { label: string; value: string; valueNumber: number; min: number; max: number; step: number; disabled: boolean; left: string; right: string; onChange: (value: number) => void }) {
  return <label className={`spatial-range-control ${disabled ? 'is-disabled' : ''}`}><span className="spatial-range-head"><strong>{label}</strong><output>{value}</output></span><input type="range" min={min} max={max} step={step} value={valueNumber} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} /><span className="spatial-range-ends"><small>{left}</small><small>{right}</small></span></label>;
}

function PresetCard({ preset, index, custom, onClick, onRemove }: { preset: SpatialPreset; index: number; custom?: boolean; onClick: () => void; onRemove?: () => void }) {
  return <div className={`spatial-preset-card preset-tone-${index % 4}`}>
    <button className="spatial-preset-main" onClick={onClick}>
      <span className="spatial-preset-art"><i /><i /><i /></span>
      <span className="spatial-preset-copy"><small>{custom ? 'YOUR MIX' : 'AURORA RECIPE'}</small><strong>{preset.name}</strong><span>{preset.note}</span></span>
      <Icon name="chevron-right" size={16} />
    </button>
    {onRemove && <button className="spatial-preset-remove" onClick={onRemove} aria-label={`Remove ${preset.name}`}><Icon name="x" size={13} /></button>}
  </div>;
}

function LocalTrack({ track, index, tracks }: { track: MediaTrack; index: number; tracks: MediaTrack[] }) {
  return <button className="spatial-local-track" onClick={() => usePlaybackStore.getState().playTrack(track, tracks, 'Local music', index)}><Icon name="play" size={13} /><span>{track.title}</span><small>{track.artist}</small></button>;
}
