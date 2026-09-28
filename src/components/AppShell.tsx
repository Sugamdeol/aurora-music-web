import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { useRoomStore } from '../room/client';
import { Icon, type IconName } from './Icon';
import { IconButton } from './primitives';
import { PlayerDock, PlayerOverlays } from './Player';

const primaryNav: Array<{ to: string; label: string; icon: IconName; end?: boolean }> = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/explore', label: 'Explore', icon: 'sparkles' },
  { to: '/ai', label: 'Studio', icon: 'sparkles' },
  { to: '/room', label: 'Together', icon: 'users' },
  { to: '/library', label: 'Library', icon: 'library' },
];

const secondaryNav: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/history', label: 'Listening history', icon: 'clock' },
  { to: '/stats', label: 'Listening stats', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function NavItem({ to, label, icon, end }: { to: string; label: string; icon: IconName; end?: boolean }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}><Icon name={icon} /><span>{label}</span></NavLink>;
}

export function AppShell() {
  const navigate = useNavigate();
  const playlists = useLibraryStore((state) => state.playlists);
  const appearance = useLibraryStore((state) => state.appearance);
  const currentTrack = usePlaybackStore((state) => state.currentTrack);
  const roomStatus = useRoomStore((state) => state.status);

  useEffect(() => {
    if (roomStatus !== 'connected') return;
    const savedRate = usePlaybackStore.getState().playbackRate;
    usePlaybackStore.setState({ playbackRate: 1 });
    return () => usePlaybackStore.setState({ playbackRate: savedRate });
  }, [roomStatus]);

  useEffect(() => {
    document.documentElement.dataset.style = appearance.style;
    document.documentElement.dataset.theme = appearance.colorMode;
    document.documentElement.dataset.oled = String(appearance.oled);
    document.documentElement.dataset.compact = String(appearance.compactRows);
    document.documentElement.dataset.smooth = String(appearance.smoothMode);
    document.documentElement.style.setProperty('--accent', appearance.accent);
    document.documentElement.classList.toggle('reduce-motion', appearance.reduceMotion);
  }, [appearance]);

  useEffect(() => {
    const artwork = currentTrack?.artwork;
    document.documentElement.style.setProperty('--track-artwork', artwork ? `url("${artwork.replace(/["\\]/g, (character) => encodeURIComponent(character))}")` : 'none');
  }, [currentTrack?.artwork]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        navigate('/search');
        window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-search-input]')?.focus(), 60);
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const isInteractive = Boolean(target?.closest('button, a, input, textarea, select, [role="button"], [role="tab"], [contenteditable="true"]'));
      if (isInteractive || event.ctrlKey || event.metaKey || event.altKey || document.querySelector('.modal-scrim, .choice-scrim, .detail-sheet')) return;
      const player = usePlaybackStore.getState();
      if (currentTrack && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        if (event.shiftKey) event.key === 'ArrowLeft' ? player.previous() : player.next();
        else { player.seek(player.position + (event.key === 'ArrowLeft' ? -10 : 10)); useRoomStore.getState().broadcastPlayback('seek'); }
      }
      if (currentTrack && event.key.toLowerCase() === 'm') player.toggleMute();
      if (event.code === 'Space' && !isInteractive && currentTrack) {
        event.preventDefault();
        usePlaybackStore.getState().togglePlayback();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTrack, navigate]);

  return <div className="aurora-app">
    <div className="song-ambient" aria-hidden="true" />
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="side-rail glass-surface">
      <NavLink to="/" className="brand-lockup" aria-label="Aurora Music home"><img src="/aurora.svg" alt="" /><span><strong>Aurora</strong><small>by Sugam Deol</small></span></NavLink>
      <nav className="desktop-nav" aria-label="Main navigation">{primaryNav.map((item) => <NavItem key={item.to} {...item} />)}</nav>
      <div className="rail-section">
        <div className="rail-heading"><span>Your playlists</span><button onClick={() => navigate('/library?create=1')} aria-label="Create playlist"><Icon name="plus" size={16} /></button></div>
        <div className="rail-playlists">{playlists.slice(0, 8).map((playlist) => <NavLink key={playlist.id} to={`/playlist/local/${encodeURIComponent(playlist.id)}`}><Icon name="disc" size={15} /><span>{playlist.name}</span></NavLink>)}{!playlists.length && <p>Playlists you make will live here.</p>}</div>
      </div>
      <div className="rail-spacer" />
      <nav className="desktop-nav secondary-nav" aria-label="Personal navigation">{secondaryNav.map((item) => <NavItem key={item.to} {...item} />)}</nav>
      <div className="service-line"><span /><span>{roomStatus === 'connected' ? 'Listening together' : 'Ready to play'}</span></div>
    </aside>

    <main className="main-stage" id="main-content" tabIndex={-1}>
      <header className="top-bar">
        <NavLink to="/" className="mobile-brand"><img src="/aurora.svg" alt="" /><span>Aurora</span></NavLink>
        <button className="search-shortcut" aria-label="Search songs, artists, albums" onClick={() => navigate('/search')}><Icon name="search" /><span>Search songs, artists, albums</span><kbd>Ctrl K</kbd></button>
        <IconButton icon={appearance.colorMode === 'dark' ? 'sun' : 'moon'} label={`Switch to ${appearance.colorMode === 'dark' ? 'light' : 'dark'} mode`} onClick={() => void useLibraryStore.getState().updateAppearance({ colorMode: appearance.colorMode === 'dark' ? 'light' : 'dark' })} />
        <IconButton icon="settings" label="Open settings" onClick={() => navigate('/settings')} />
      </header>
      <div className="route-stage"><Outlet /></div>
    </main>

    <PlayerDock />
    <nav className="bottom-nav glass-surface" aria-label="Main navigation">{primaryNav.map((item) => <NavItem key={item.to} {...item} />)}</nav>
    <PlayerOverlays />
  </div>;
}
