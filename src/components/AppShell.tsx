import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../store/library';
import { usePlaybackStore } from '../store/playback';
import { useRoomStore } from '../room/client';
import { Icon, type IconName } from './Icon';
import { IconButton } from './primitives';
import { PlayerDock, PlayerOverlays } from './Player';
import { useDialog } from '../hooks/useDialog';
import { AdBanner } from './AdBanner';

function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(true, onClose);
  const rows: Array<[string, string]> = [
    ['Space', 'Play / pause'],
    ['← / →', 'Seek 10 seconds'],
    ['Shift + ← / →', 'Previous / next song'],
    ['M', 'Mute'],
    ['Ctrl / ⌘ + K', 'Search'],
    ['?', 'This shortcut list'],
    ['Esc', 'Close player or panel'],
  ];
  return <div className="detail-sheet shortcuts-sheet" ref={ref} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1}>
    <button className="sheet-backdrop" onClick={onClose} aria-label="Close panel" />
    <div className="sheet-panel glass-surface"><span className="sheet-grabber" /><IconButton icon="x" label="Close panel" className="sheet-close" onClick={onClose} />
      <div className="sheet-content"><div className="sheet-title"><div><span>Work the keys</span><h2>Keyboard shortcuts</h2></div></div>
        <table className="shortcuts-table"><tbody>{rows.map(([keys, action]) => <tr key={keys}><th scope="row"><kbd>{keys}</kbd></th><td>{action}</td></tr>)}</tbody></table>
      </div>
    </div>
  </div>;
}

const primaryNav: Array<{ to: string; label: string; mobileLabel?: string; icon: IconName; end?: boolean }> = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/explore', label: 'Explore', icon: 'sparkles' },
  { to: '/ai', label: 'AI Studio', mobileLabel: 'AI', icon: 'sparkles' },
  { to: '/audio-studio', label: 'Audio Studio', mobileLabel: 'Audio', icon: 'spatial' },
  { to: '/room', label: 'Together', mobileLabel: 'Room', icon: 'users' },
  { to: '/library', label: 'Library', icon: 'library' },
];

const secondaryNav: Array<{ to: string; label: string; icon: IconName }> = [
  { to: '/history', label: 'Listening history', icon: 'clock' },
  { to: '/stats', label: 'Listening stats', icon: 'chart' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

function NavItem({ to, label, mobileLabel, icon, end }: { to: string; label: string; mobileLabel?: string; icon: IconName; end?: boolean }) {
  return <NavLink to={to} end={end} className={({ isActive }) => `nav-link ${isActive ? 'is-active' : ''}`}><Icon name={icon} /><span className="nav-desktop-label">{label}</span><span className="nav-mobile-label">{mobileLabel ?? label}</span></NavLink>;
}

function MobileNavigationSheet({ onClose }: { onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(true, onClose);
  const items = [...primaryNav.filter((item) => ['/explore', '/ai', '/room'].includes(item.to)), ...secondaryNav];
  return <div className="detail-sheet mobile-navigation-sheet" ref={ref} role="dialog" aria-modal="true" aria-label="More navigation" tabIndex={-1}>
    <button className="sheet-backdrop" onClick={onClose} aria-label="Close navigation" />
    <div className="sheet-panel glass-surface"><IconButton icon="x" label="Close navigation" className="sheet-close" onClick={onClose} />
      <div className="sheet-content"><div className="sheet-title"><h2>More from Aurora</h2></div>
        <nav aria-label="More navigation">{items.map((item) => <NavLink key={item.to} to={item.to} onClick={onClose} className="mobile-more-link"><Icon name={item.icon} /><span>{item.label}</span><Icon name="chevron-right" size={16} /></NavLink>)}</nav>
      </div>
    </div>
  </div>;
}

export function AppShell() {
  const navigate = useNavigate();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
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
    const root = document.documentElement;
    root.style.setProperty('--track-artwork', artwork ? `url("${artwork.replace(/["\\]/g, (character) => encodeURIComponent(character))}")` : 'none');
    root.dataset.tint = 'false';
    if (!artwork) return;
    // Paint the ambient wash from a 24px copy of the artwork instead of a live
    // 105px CSS blur over the full image — same liquid look, far less GPU.
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let cancelled = false;
    image.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 24;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const side = Math.min(image.width, image.height);
        ctx.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 24, 24);
        root.style.setProperty('--track-tint', `url("${canvas.toDataURL('image/jpeg', 0.72)}")`);
        root.dataset.tint = 'true';
      } catch {
        root.dataset.tint = 'false'; // Tainted canvas: keep the live-blur fallback.
      }
    };
    image.onerror = () => { if (!cancelled) root.dataset.tint = 'false'; };
    image.src = artwork;
    return () => { cancelled = true; };
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
      if (event.key === '?') { setShortcutsOpen(true); return; }
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
      <AdBanner />
    </main>

    <PlayerDock />
    <nav className="bottom-nav glass-surface" aria-label="Main navigation">{primaryNav.filter((item) => ['/', '/search', '/audio-studio', '/library'].includes(item.to)).map((item) => <NavItem key={item.to} {...item} />)}<button className="nav-link mobile-more-button" aria-label="More navigation" aria-expanded={mobileNavigationOpen} onClick={() => setMobileNavigationOpen(true)}><Icon name="more" /><span>More</span></button></nav>
    <PlayerOverlays />
    {mobileNavigationOpen && <MobileNavigationSheet onClose={() => setMobileNavigationOpen(false)} />}
    {shortcutsOpen && <ShortcutsSheet onClose={() => setShortcutsOpen(false)} />}
  </div>;
}
