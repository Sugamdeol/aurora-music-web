export type MediaKind = 'song' | 'video' | 'album' | 'artist' | 'playlist' | 'local';
export type RepeatMode = 'off' | 'all' | 'one';
export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error';

export interface ArtistCredit {
  id?: string;
  name: string;
}

export interface MediaTrack {
  id: string;
  kind: 'song' | 'video' | 'local';
  title: string;
  artist: string;
  artists?: ArtistCredit[];
  artistId?: string;
  album?: string;
  albumId?: string;
  artwork?: string;
  durationSeconds?: number;
  durationLabel?: string;
  source: 'remote' | 'local';
  streamUrl?: string;
  fileId?: string;
  explicit?: boolean;
  addedAt?: number;
  lastPlayedAt?: number;
  playCount?: number;
  recommended?: boolean;
}

export interface MediaEntity {
  id: string;
  browseId?: string;
  kind: MediaKind;
  title: string;
  subtitle?: string;
  artist?: string;
  artistId?: string;
  artwork?: string;
  description?: string;
  year?: string;
  count?: string | number;
}

export interface MediaSection {
  id: string;
  title: string;
  items: Array<MediaEntity | MediaTrack>;
}

/** A top-level Explore destination (Charts, New releases, a mood/genre). */
export interface ExploreCategory {
  title: string;
  browseId: string;
}

export interface EntityDetail {
  kind: 'album' | 'artist' | 'playlist';
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  artist?: string;
  artistId?: string;
  year?: string;
  count?: string | number;
  artwork?: string;
  sections: MediaSection[];
  tracks: MediaTrack[];
}

export interface LocalPlaylist {
  id: string;
  name: string;
  description?: string;
  artwork?: string;
  createdAt: number;
  updatedAt: number;
  tracks: MediaTrack[];
}

export interface LyricLine {
  time?: number;
  text: string;
  romanized?: string;
}

export interface RoomUser {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
}

export interface RoomMessage {
  id: string;
  userId?: string;
  username: string;
  message: string;
  sentAt: number;
}

export interface RoomSnapshot {
  code: string;
  role: 'host' | 'guest';
  userId: string;
  users: RoomUser[];
  allowParticipantControl: boolean;
  queue: MediaTrack[];
  currentTrackId?: string;
  positionMs?: number;
  playing?: boolean;
}

export interface AppearanceSettings {
  style: 'glass' | 'material';
  colorMode: 'dark' | 'light';
  oled: boolean;
  reduceMotion: boolean;
  compactRows: boolean;
  smoothMode: boolean;
  accent: string;
}

export interface PlaybackSettings {
  transitionMode: 'off' | 'crossfade' | 'automix';
  crossfadeSeconds: number;
  equalizerEnabled: boolean;
  equalizerGains: number[];
  autoplay: boolean;
  normalizeVolume: boolean;
  preferredQuality: 'auto' | 'high' | 'data-saver';
}

export interface CapabilitySnapshot {
  indexedDb: boolean;
  mediaSession: boolean;
  webAudio: boolean;
  fileSystemAccess: boolean;
  serviceWorker: boolean;
  broadcastChannel: boolean;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  style: 'glass',
  colorMode: 'dark',
  oled: false,
  reduceMotion: false,
  compactRows: false,
  smoothMode: true,
  accent: '#8aff18',
};

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  transitionMode: 'automix',
  crossfadeSeconds: 6,
  equalizerEnabled: false,
  equalizerGains: [0, 0, 0, 0, 0],
  autoplay: true,
  normalizeVolume: false,
  preferredQuality: 'auto',
};

export function isTrack(item: MediaEntity | MediaTrack): item is MediaTrack {
  return 'source' in item && (item.kind === 'song' || item.kind === 'video' || item.kind === 'local');
}

export function formatDuration(seconds?: number): string {
  if (!Number.isFinite(seconds) || !seconds || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function parseDuration(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const pieces = value.split(':').map(Number);
  if (pieces.some((piece) => !Number.isFinite(piece))) return undefined;
  return pieces.reduce((total, piece) => total * 60 + piece, 0);
}
