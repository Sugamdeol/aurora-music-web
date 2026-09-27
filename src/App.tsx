import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Icon } from './components/Icon';
import { getSetting, setSetting } from './lib/db';
import { usePlaybackEngine } from './hooks/usePlaybackEngine';
import { useLibraryStore } from './store/library';
import { usePlaybackStore } from './store/playback';
import { useRoomStore } from './room/client';
import type { AppearanceSettings } from './domain/media';
import { currentSyncAccount, enableAutomaticSync, syncLibrary } from './lib/sync';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then((module) => ({ default: module.SearchPage })));
const ExplorePage = lazy(() => import('./pages/ExplorePage').then((module) => ({ default: module.ExplorePage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then((module) => ({ default: module.LibraryPage })));
const EntityPage = lazy(() => import('./pages/EntityPage').then((module) => ({ default: module.EntityPage })));
const RoomPage = lazy(() => import('./pages/RoomPage').then((module) => ({ default: module.RoomPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const StatsPage = lazy(() => import('./pages/StatsPage').then((module) => ({ default: module.StatsPage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((module) => ({ default: module.HistoryPage })));
const AiPage = lazy(() => import('./pages/AiPage').then((module) => ({ default: module.AiPage })));

export default function App() {
  usePlaybackEngine();
  const [booting, setBooting] = useState(true);
  const [showChoice, setShowChoice] = useState(false);
  const [styleChoiceRequired, setStyleChoiceRequired] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        // Library bootstrap owns the one-time legacy migration; consumers read only after it commits.
        await useLibraryStore.getState().bootstrap();
        try {
          if (await getSetting('sync.enabled', false) && await currentSyncAccount()) { await syncLibrary(); enableAutomaticSync(); }
        } catch (error) { console.warn('Aurora account sync is temporarily unavailable:', error); }
        await Promise.all([usePlaybackStore.getState().bootstrap(), useRoomStore.getState().bootstrap()]);
        const complete = await getSetting('onboarding.complete', false).catch(() => false);
        const nameComplete = await getSetting('onboarding.name.complete', false).catch(() => false);
        if (active) { setStyleChoiceRequired(!complete); setShowChoice(!complete || !nameComplete); }
      } catch (error) {
        console.error('Aurora could not restore local state:', error);
      } finally {
        if (active) setBooting(false);
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let previous = usePlaybackStore.getState();
    return usePlaybackStore.subscribe((state) => {
      const room = useRoomStore.getState();
      if (room.status !== 'connected' || room.suppressBroadcast) { previous = state; return; }
      if (state.queue !== previous.queue) room.broadcastPlayback('sync_queue');
      if (state.currentTrack?.id !== previous.currentTrack?.id) room.broadcastPlayback('change_track');
      else if (state.isPlaying !== previous.isPlaying) room.broadcastPlayback(state.isPlaying ? 'play' : 'pause');
      previous = state;
    });
  }, []);

  if (booting) return <div className="app-boot"><img src="/aurora.svg" alt="" /><span className="boot-wave"><i /><i /><i /><i /></span><p>Opening your music</p></div>;
  return <BrowserRouter>
    <Suspense fallback={<div className="route-loading" role="status">Opening your music…</div>}>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="explore" element={<ExplorePage />} />
          <Route path="ai" element={<AiPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="room" element={<RoomPage />} />
          <Route path="room/:roomCode" element={<RoomPage />} />
          <Route path="album/:id" element={<EntityPage forcedKind="album" />} />
          <Route path="artist/:id" element={<EntityPage forcedKind="artist" />} />
          <Route path="playlist/remote/:id" element={<EntityPage forcedKind="playlist" />} />
          <Route path="playlist/local/:id" element={<EntityPage forcedKind="playlist" local />} />
          <Route path="entity/:kind/:id" element={<EntityPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="profile" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
    {showChoice && <StyleChoice showStyle={styleChoiceRequired} onComplete={() => setShowChoice(false)} />}
  </BrowserRouter>;
}


function StyleChoice({ showStyle, onComplete }: { showStyle: boolean; onComplete: () => void }) {
  const current = useLibraryStore((state) => state.appearance.style);
  const [style, setStyle] = useState<AppearanceSettings['style']>(current || 'glass');
  const username = useRoomStore((state) => state.username);
  const setPreferences = useRoomStore((state) => state.setPreferences);
  const [name, setName] = useState(username === 'Listener' ? '' : username);
  const finish = async () => {
    const cleanName = name.trim().slice(0, 32);
    if (!cleanName) return;
    await setPreferences({ username: cleanName });
    await setSetting('onboarding.name.complete', true);
    if (showStyle) { await useLibraryStore.getState().updateAppearance({ style }); await setSetting('onboarding.complete', true); }
    onComplete();
  };
  return <div className="choice-scrim" role="dialog" aria-modal="true" aria-labelledby="choice-title"><div className="choice-card glass-surface"><img src="/aurora.svg" alt="" /><span>Welcome to Aurora</span><h1 id="choice-title">{showStyle ? 'Make it yours.' : 'What should we call you?'}</h1><p>{showStyle ? 'Choose a name and how music feels. You can change these later.' : 'Your name appears in your profile and listening rooms.'}</p><label className="welcome-name"><span>Your name</span><input autoFocus value={name} maxLength={32} autoComplete="nickname" placeholder="Enter your name" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void finish(); }} /></label>{showStyle && <div className="choice-options"><button className={style === 'glass' ? 'is-selected' : ''} onClick={() => setStyle('glass')}><span className="style-preview glass-preview"><i /><i /><i /></span><div><strong>Liquid Glass + Apple Music</strong><small>Soft depth, blur, and glowing lime</small></div>{style === 'glass' && <Icon name="check" />}</button><button className={style === 'material' ? 'is-selected' : ''} onClick={() => setStyle('material')}><span className="style-preview material-preview"><i /><i /><i /></span><div><strong>Material UI</strong><small>Clear surfaces and familiar controls</small></div>{style === 'material' && <Icon name="check" />}</button></div>}<button className="primary-button choice-continue" disabled={!name.trim()} onClick={() => void finish()}>Continue</button><small>A personal music space by Sugam Deol</small></div></div>;
}

function NotFound() { return <div className="page not-found"><Icon name="disc" size={44} /><h1>This track goes nowhere.</h1><p>The page you opened is not part of this library.</p><a className="primary-button" href="/">Back home</a></div>; }
