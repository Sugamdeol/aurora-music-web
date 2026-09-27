import { useEffect, useRef, useState } from 'react';
import type { AppearanceSettings, CapabilitySnapshot, MediaTrack, PlaybackSettings } from '../domain/media';
import { db, type HistoryRecord } from '../lib/db';
import { useLibraryStore } from '../store/library';
import { PageHeader } from '../components/primitives';
import { Icon } from '../components/Icon';
import { useRoomStore } from '../room/client';
import { prepareGoogleIdentity, useYouTubeAccountStore } from '../store/youtubeAccount';
import { EqualizerControls } from '../components/EqualizerControls';

const accentChoices = [
  { name: 'Aurora lime', value: '#8aff18' },
  { name: 'Ice blue', value: '#7db8ff' },
  { name: 'Electric violet', value: '#bb8cff' },
  { name: 'Solar gold', value: '#ffd35a' },
];

function capabilities(): CapabilitySnapshot {
  return {
    indexedDb: 'indexedDB' in window,
    mediaSession: 'mediaSession' in navigator,
    webAudio: 'AudioContext' in window || 'webkitAudioContext' in window,
    fileSystemAccess: 'showOpenFilePicker' in window,
    serviceWorker: 'serviceWorker' in navigator,
    broadcastChannel: 'BroadcastChannel' in window,
  };
}

export function SettingsPage() {
  const appearance = useLibraryStore((state) => state.appearance);
  const playback = useLibraryStore((state) => state.playbackSettings);
  const updateAppearance = useLibraryStore((state) => state.updateAppearance);
  const updatePlayback = useLibraryStore((state) => state.updatePlaybackSettings);
  const playlists = useLibraryStore((state) => state.playlists);
  const likedTracks = useLibraryStore((state) => state.likedTracks);
  const recent = useLibraryStore((state) => state.recent);
  const localTracks = useLibraryStore((state) => state.localTracks);
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const createPlaylist = useLibraryStore((state) => state.createPlaylist);
  const addToPlaylist = useLibraryStore((state) => state.addToPlaylist);
  const recordPlay = useLibraryStore((state) => state.recordPlay);
  const roomUsername = useRoomStore((state) => state.username);
  const roomStatus = useRoomStore((state) => state.status);
  const setRoomPreferences = useRoomStore((state) => state.setPreferences);
  const [profileName, setProfileName] = useState(roomUsername || 'Listener');
  const [storage, setStorage] = useState<{ usage: number; quota: number }>();
  const [message, setMessage] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const caps = capabilities();

  useEffect(() => { void navigator.storage?.estimate().then((value) => setStorage({ usage: value.usage ?? 0, quota: value.quota ?? 0 })); }, [localTracks.length]);
  useEffect(() => { setProfileName(roomUsername || 'Listener'); }, [roomUsername]);
  const saveProfileName = () => {
    const username = profileName.trim().slice(0, 32) || 'Listener';
    setProfileName(username);
    void setRoomPreferences({ username });
  };
  const patchAppearance = (patch: Partial<AppearanceSettings>) => void updateAppearance(patch);
  const exportLibrary = async () => {
    const history = await db.history.toArray();
    const tracks = (await db.tracks.toArray()).filter((track) => track.source === 'remote');
    const remoteIds = new Set(tracks.map((track) => track.id));
    const data = {
      format: 'aurora-library', version: 3, exportedAt: new Date().toISOString(),
      liked: likedTracks.filter((track) => track.source === 'remote'),
      recent: recent.filter((track) => track.source === 'remote'),
      playlists: playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter((track) => track.source === 'remote') })),
      tracks, history: history.filter((item) => remoteIds.has(item.trackId)).map(({ id: _id, ...item }) => item),
      appearance, playback,
      note: localTracks.length ? `${localTracks.length} local audio files were not included.` : undefined,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `aurora-library-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage('Library exported.');
  };
  const importLibrary = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (data.format !== 'aurora-library' || !Array.isArray(data.playlists)) throw new Error('This is not an Aurora library backup.');
      const liked = Array.isArray(data.liked) ? data.liked as MediaTrack[] : [];
      for (const track of liked) if (track?.id && !useLibraryStore.getState().likedIds.has(track.id)) await toggleLike(track);
      const restoredRecent = Array.isArray(data.recent) ? data.recent as MediaTrack[] : [];
      const history = Array.isArray(data.history) ? data.history as HistoryRecord[] : [];
      if (Array.isArray(data.tracks) && Number(data.version) >= 3) {
        const remoteTracks = (data.tracks as MediaTrack[]).filter((track) => track?.id && track.source === 'remote');
        const byId = new Map(remoteTracks.map((track) => [track.id, track]));
        await db.transaction('rw', db.history, db.tracks, async () => {
          const existingHistory = await db.history.toArray();
          const seen = new Set(existingHistory.map((item) => `${item.trackId}:${item.playedAt}`));
          const imported = history.filter((item) => {
            const key = `${item.trackId}:${item.playedAt}`;
            if (!byId.has(item.trackId) || !Number.isFinite(item.playedAt) || item.playedAt <= 0 || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          await db.history.bulkAdd(imported.map(({ id: _id, ...item }) => item));
          for (const track of remoteTracks) {
            const existing = await db.tracks.get(track.id);
            const plays = imported.filter((item) => item.trackId === track.id);
            await db.tracks.put({ ...track, ...existing, playCount: (existing?.playCount ?? 0) + plays.length, lastPlayedAt: Math.max(existing?.lastPlayedAt ?? 0, ...plays.map((item) => item.playedAt)) || undefined });
          }
        });
        await useLibraryStore.getState().bootstrap();
      } else {
        for (const track of [...restoredRecent].reverse()) if (track?.id && track.source === 'remote') await recordPlay(track);
      }
      for (const item of data.playlists as Array<{ name?: string; tracks?: MediaTrack[] }>) {
        const playlist = await createPlaylist(item.name || 'Imported playlist');
        for (const track of item.tracks ?? []) if (track?.id) await addToPlaylist(playlist.id, track);
      }
      if (data.appearance && typeof data.appearance === 'object') await updateAppearance(data.appearance as Partial<AppearanceSettings>);
      if (data.playback && typeof data.playback === 'object') await updatePlayback(data.playback as Partial<PlaybackSettings>);
      setMessage('Library imported. Local audio files must be added again.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The backup could not be imported.'); }
    finally { event.target.value = ''; }
  };
  const clearHistory = async () => {
    if (!window.confirm('Clear all listening history? Your liked songs and playlists will stay.')) return;
    await db.transaction('rw', db.history, db.tracks, async () => {
      await db.history.clear();
      await db.tracks.toCollection().modify((track) => { track.lastPlayedAt = undefined; track.playCount = 0; });
    });
    useLibraryStore.setState({ recent: [] });
    setMessage('Listening history cleared.');
  };

  const storageText = storage ? `${(storage.usage / 1024 / 1024).toFixed(1)} MB used${storage.quota ? ` of ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB` : ''}` : 'Checking storage…';
  return <div className="page settings-page">
    <PageHeader title="Your Aurora" description="Tune the look, playback, and local data on this device." />
    <section className="profile-card glass-surface"><span className="profile-avatar">{(profileName.trim()[0] || 'L').toUpperCase()}</span><div><label htmlFor="profile-name">Display name</label><input id="profile-name" name="displayName" autoComplete="nickname" value={profileName} maxLength={32} onChange={(event) => setProfileName(event.target.value)} onBlur={saveProfileName} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><p>Used when you join a listening room.</p></div><img src="/aurora.svg" alt="Aurora Music" /></section>

    <SettingsGroup title="Personalized suggestions"><YouTubeAccountSettings /></SettingsGroup>

    <SettingsGroup title="Appearance">
      <div className="style-options"><button className={appearance.style === 'glass' ? 'is-selected' : ''} onClick={() => patchAppearance({ style: 'glass' })}><span className="style-preview glass-preview"><i /><i /><i /></span><span><strong>Liquid Glass + Apple Music</strong><small>Album-tinted glass with Aurora accents</small></span>{appearance.style === 'glass' && <Icon name="check" />}</button><button className={appearance.style === 'material' ? 'is-selected' : ''} onClick={() => patchAppearance({ style: 'material' })}><span className="style-preview material-preview"><i /><i /><i /></span><span><strong>Material UI</strong><small>Solid surfaces with familiar structure</small></span>{appearance.style === 'material' && <Icon name="check" />}</button></div>
      <div className="setting-block"><div><strong>Color mode</strong><small>Choose a bright or dark glass palette</small></div><div className="mode-options"><button className={appearance.colorMode === 'dark' ? 'is-selected' : ''} aria-pressed={appearance.colorMode === 'dark'} onClick={() => patchAppearance({ colorMode: 'dark' })}>Dark</button><button className={appearance.colorMode === 'light' ? 'is-selected' : ''} aria-pressed={appearance.colorMode === 'light'} onClick={() => patchAppearance({ colorMode: 'light', oled: false })}>Light</button></div></div>
      <SettingToggle title="OLED black" description="Use true black behind the interface" checked={appearance.oled} onChange={(oled) => patchAppearance({ oled })} />
      <SettingToggle title="Reduce motion" description="Minimize transitions and ambient movement" checked={appearance.reduceMotion} onChange={(reduceMotion) => patchAppearance({ reduceMotion })} />
      <SettingToggle title="Compact song rows" description="Fit more music in long lists" checked={appearance.compactRows} onChange={(compactRows) => patchAppearance({ compactRows })} />
      <div className="setting-block"><div><strong>Accent color</strong><small>Used only for active controls and progress</small></div><div className="accent-choices">{accentChoices.map((choice) => <button key={choice.value} className={appearance.accent.toLowerCase() === choice.value ? 'is-selected' : ''} style={{ background: choice.value }} onClick={() => patchAppearance({ accent: choice.value })} aria-label={choice.name} title={choice.name}>{appearance.accent.toLowerCase() === choice.value && <Icon name="check" size={15} />}</button>)}</div></div>
    </SettingsGroup>

    <SettingsGroup title="Playback">
      <label className="setting-block"><div><strong>Song transitions</strong><small>{playback.transitionMode === 'automix' ? 'Adaptive blends between songs. Consecutive album tracks stay intact.' : playback.transitionMode === 'crossfade' ? 'Fade the next song in as the current song fades out.' : 'Play each song from beginning to end.'}</small></div><select aria-label="Song transitions" value={playback.transitionMode} onChange={(event) => void updatePlayback({ transitionMode: event.target.value as PlaybackSettings['transitionMode'] })}><option value="off">Off</option><option value="crossfade">Crossfade</option><option value="automix">Auto Mix</option></select></label>
      {playback.transitionMode === 'crossfade' && <label className="setting-block"><div><strong>Crossfade duration</strong><small>{playback.crossfadeSeconds} seconds</small></div><input aria-label="Crossfade duration" type="range" min="1" max="12" step="1" value={playback.crossfadeSeconds} onChange={(event) => void updatePlayback({ crossfadeSeconds: Number(event.target.value) })} /></label>}
      {roomStatus === 'connected' && <p className="transition-note">Song transitions pause while listening together to keep everyone in sync.</p>}
      <SettingToggle title="Continue with similar music" description="Load related tracks when a queue reaches the end" checked={playback.autoplay} onChange={(autoplay) => void updatePlayback({ autoplay })} />
      <SettingToggle title="Normalize volume" description="Reduce large volume changes between tracks when supported" checked={playback.normalizeVolume} onChange={(normalizeVolume) => void updatePlayback({ normalizeVolume })} />
      <label className="setting-block"><div><strong>Streaming quality</strong><small>Higher quality can use more data</small></div><select value={playback.preferredQuality} onChange={(event) => void updatePlayback({ preferredQuality: event.target.value as typeof playback.preferredQuality })}><option value="auto">Automatic</option><option value="high">High</option><option value="data-saver">Data saver</option></select></label>
    </SettingsGroup>

    <SettingsGroup title="Sound and equalizer"><EqualizerControls /></SettingsGroup>

    <SettingsGroup title="Library and storage">
      <div className="setting-block"><span className="setting-glyph"><Icon name="folder" /></span><div><strong>Browser storage</strong><small>{storageText} · {localTracks.length} local files</small></div></div>
      <button className="setting-block setting-action" onClick={() => void exportLibrary().catch(() => setMessage('The library could not be exported.'))}><span className="setting-glyph"><Icon name="download" /></span><div><strong>Export library</strong><small>Save playlists, liked songs, settings, and listening history</small></div><Icon name="chevron-right" /></button>
      <button className="setting-block setting-action" onClick={() => importRef.current?.click()}><span className="setting-glyph"><Icon name="upload" /></span><div><strong>Import a backup</strong><small>Merge another Aurora library into this browser</small></div><Icon name="chevron-right" /><input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importLibrary} /></button>
      <button className="setting-block setting-action danger-setting" onClick={() => void clearHistory()}><span className="setting-glyph"><Icon name="trash" /></span><div><strong>Clear listening history</strong><small>Keep liked songs, playlists, and local files</small></div><Icon name="chevron-right" /></button>
    </SettingsGroup>

    <SettingsGroup title="Browser capabilities"><div className="capability-grid">{Object.entries(caps).map(([key, enabled]) => <div key={key}><span className={enabled ? 'available' : ''}><Icon name={enabled ? 'check' : 'x'} size={14} /></span><strong>{capabilityLabels[key as keyof CapabilitySnapshot]}</strong><small>{enabled ? 'Available' : 'Not available'}</small></div>)}</div></SettingsGroup>
    <section className="about-aurora"><img src="/aurora.svg" alt="" /><div><strong>Aurora Music</strong><span>Music floating inside dark glass.</span><small>Web client · by Sugam Deol</small></div></section>
    {message && <div className="toast" role="status">{message}<button onClick={() => setMessage('')} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}
  </div>;
}

function SettingsGroup({ title, children }: React.PropsWithChildren<{ title: string }>) { return <section className="settings-group"><h2>{title}</h2><div>{children}</div></section>; }
function SettingToggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="setting-block toggle-setting"><div><strong>{title}</strong><small>{description}</small></div><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>; }
function YouTubeAccountSettings() {
  const configured = useYouTubeAccountStore((state) => state.configured);
  const connected = useYouTubeAccountStore((state) => state.connected);
  const connecting = useYouTubeAccountStore((state) => state.connecting);
  const name = useYouTubeAccountStore((state) => state.name);
  const likedTracks = useYouTubeAccountStore((state) => state.likedTracks);
  const error = useYouTubeAccountStore((state) => state.error);
  const connect = useYouTubeAccountStore((state) => state.connect);
  const disconnect = useYouTubeAccountStore((state) => state.disconnect);
  const [identityReady, setIdentityReady] = useState(false);
  const [identityError, setIdentityError] = useState('');
  useEffect(() => { void prepareGoogleIdentity().then(() => setIdentityReady(true)).catch((reason: unknown) => setIdentityError(reason instanceof Error ? reason.message : 'Google sign-in could not load.')); }, []);
  return <div className="youtube-account-setting">
    <div className="youtube-account-copy"><span className="youtube-account-mark">▶</span><div><strong>{connected ? `Connected to ${name}` : 'Connect YouTube Music'}</strong><small>{connected ? `${likedTracks.length} liked videos will help shape your mixes on this device.` : 'Use your liked music to personalize Aurora suggestions.'}</small></div></div>
    {!configured && <p className="youtube-account-note">Sign-in needs a Google web OAuth client ID and YouTube Data API key configured for this site.</p>}
    {(error || identityError) && <p className="youtube-account-error" role="alert">{error || identityError}</p>}
    <button className={connected ? 'secondary-button youtube-account-button' : 'primary-button youtube-account-button'} disabled={connecting || (!connected && (!configured || !identityReady))} onClick={() => connected ? disconnect() : void connect()}>{connecting ? 'Connecting…' : connected ? 'Disconnect' : !identityReady ? 'Loading Google sign-in…' : 'Connect YouTube Music'}</button>
  </div>;
}
const capabilityLabels: Record<keyof CapabilitySnapshot, string> = { indexedDb: 'Offline library', mediaSession: 'System media controls', webAudio: 'Advanced audio', fileSystemAccess: 'File picker', serviceWorker: 'Offline shell', broadcastChannel: 'Tab sync' };
