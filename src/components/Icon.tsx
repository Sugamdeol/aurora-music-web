import type { SVGProps } from 'react';

export type IconName =
  | 'home' | 'search' | 'library' | 'users' | 'settings' | 'chart' | 'heart' | 'plus'
  | 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'shuffle' | 'repeat' | 'repeat-one'
  | 'queue' | 'lyrics' | 'volume' | 'mute' | 'chevron-down' | 'chevron-right'
  | 'arrow-left' | 'more' | 'music' | 'disc' | 'clock' | 'folder' | 'upload'
  | 'trash' | 'download' | 'check' | 'x' | 'sparkles' | 'wifi' | 'copy' | 'drag' | 'sun' | 'moon' | 'sliders' | 'share' | 'radio' | 'spatial';

const paths: Record<IconName, React.ReactNode> = {
  sliders: <><path d="M5 3v9m0 4v5M12 3v3m0 4v11M19 3v12m0 4v2M2 12h6m1-6h6m1 9h6" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4" /></>,
  radio: <><rect x="3" y="8" width="18" height="13" rx="3" /><path d="m5 8 13-5M6 12h6m-6 4h3" /><circle cx="16" cy="15" r="2" /></>,
  spatial: <><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-28 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(32 12 12)" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  library: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.2a4 4 0 0 1 0 7.6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.5 19a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-1.1-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.1 1.7 1.7 0 0 0 10 3h.1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.5 5a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.9 9c.1.42.48.8 1.1 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  chart: <><path d="M4 20V10m6 10V4m6 16v-7m5 7H2" /></>,
  heart: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  play: <path d="m8 5 12 7-12 7z" fill="currentColor" stroke="none" />,
  pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" fill="currentColor" stroke="none" /></>,
  stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />,
  next: <><path d="m5 4 10 8-10 8z" /><path d="M19 5v14" /></>,
  previous: <><path d="M19 20 9 12l10-8z" /><path d="M5 19V5" /></>,
  shuffle: <><path d="m18 14 4 4-4 4m0-20 4 4-4 4M2 18h2.5a6 6 0 0 0 4.2-1.7l6.6-6.6A6 6 0 0 1 19.5 8H22M2 6h2.5a6 6 0 0 1 4.2 1.7M14 14l1.5 1.5A6 6 0 0 0 19.5 18H22" /></>,
  repeat: <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-5v2a3 3 0 0 1-3 3H3" /></>,
  'repeat-one': <><path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-5v2a3 3 0 0 1-3 3H3" /><path d="M11 10h2v5m-2 0h4" /></>,
  queue: <><path d="M3 6h11M3 11h11M3 16h7M18 5v11" /><circle cx="16" cy="18" r="2" /></>,
  lyrics: <><path d="M4 6h16M4 10h10M4 14h16M4 18h10" /></>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13" /></>,
  mute: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9 5 6m0-6-5 6" /></>,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'arrow-left': <><path d="m12 19-7-7 7-7M5 12h14" /></>,
  more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  disc: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 19h16" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  x: <path d="m18 6-12 12M6 6l12 12" />,
  sparkles: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="20" r="1" fill="currentColor" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  drag: <><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01" strokeWidth="3" strokeLinecap="round" /></>,
};

interface IconProps extends SVGProps<SVGSVGElement> { name: IconName; size?: number }
export function Icon({ name, size = 20, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
