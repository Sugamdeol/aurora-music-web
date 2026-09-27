import Dexie, { type EntityTable } from 'dexie';
import type { AppearanceSettings, LocalPlaylist, MediaTrack, PlaybackSettings } from '../domain/media';
import { DEFAULT_APPEARANCE, DEFAULT_PLAYBACK_SETTINGS, parseDuration } from '../domain/media';
import { normalizeMedia } from './api';

export interface TrackRecord extends MediaTrack {
  likedAt?: number;
  unlikedAt?: number;
  lastPlayedAt?: number;
  playCount?: number;
}

export interface PlaylistRecord {
  id: string;
  name: string;
  description?: string;
  artwork?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlaylistTrackRecord {
  id?: number;
  playlistId: string;
  trackId: string;
  position: number;
  addedAt: number;
}

export interface AudioFileRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  blob: Blob;
}

export interface HistoryRecord {
  id?: number;
  trackId: string;
  playedAt: number;
  listenedSeconds?: number;
  trackTitle?: string;
  artist?: string;
  artwork?: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
  updatedAt: number;
}

class AuroraDatabase extends Dexie {
  tracks!: EntityTable<TrackRecord, 'id'>;
  playlists!: EntityTable<PlaylistRecord, 'id'>;
  playlistTracks!: EntityTable<PlaylistTrackRecord, 'id'>;
  files!: EntityTable<AudioFileRecord, 'id'>;
  history!: EntityTable<HistoryRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor() {
    super('aurora-music');
    this.version(1).stores({
      tracks: '&id, kind, source, likedAt, lastPlayedAt, artistId, albumId',
      playlists: '&id, name, updatedAt',
      playlistTracks: '++id, playlistId, trackId, [playlistId+trackId], [playlistId+position]',
      files: '&id, lastModified',
      history: '++id, trackId, playedAt',
      settings: '&key, updatedAt',
    });
    this.version(2).stores({
      tracks: '&id, kind, source, likedAt, lastPlayedAt, artistId, albumId, playCount',
      playlists: '&id, name, updatedAt',
      playlistTracks: '++id, playlistId, trackId, [playlistId+trackId], [playlistId+position]',
      files: '&id, lastModified',
      history: '++id, trackId, playedAt',
      settings: '&key, updatedAt',
    }).upgrade(async (transaction) => {
      await transaction.table<TrackRecord>('tracks').toCollection().modify((track) => {
        track.playCount ??= track.lastPlayedAt ? 1 : 0;
      });
    });
  }
}

export const db = new AuroraDatabase();
const LEGACY_PREFIX = 'aurora.';
const MIGRATION_KEY = 'migration.legacy-v1';

function readLegacy<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`${LEGACY_PREFIX}${key}`);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function normalizeLegacyTrack(value: unknown): TrackRecord | null {
  const normalized = normalizeMedia(value, 'song');
  if (!normalized || !('source' in normalized)) return null;
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    ...normalized,
    kind: source.local === true ? 'local' : normalized.kind,
    source: source.local === true ? 'local' : normalized.source,
    fileId: typeof source.fileId === 'string' ? source.fileId : normalized.fileId,
    durationSeconds: normalized.durationSeconds ?? parseDuration(source.duration),
    addedAt: Date.now(),
  };
}

async function readLegacyAudioFiles(): Promise<{ files: AudioFileRecord[]; tracks: TrackRecord[] }> {
  const empty = { files: [], tracks: [] };
  if (!('indexedDB' in window)) return empty;
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open('aurora-music-library'); } catch { resolve(empty); return; }
    request.onerror = () => resolve(empty);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(empty);
    };
    request.onsuccess = () => {
      const legacyDb = request.result;
      if (!legacyDb.objectStoreNames.contains('audio')) { legacyDb.close(); resolve(empty); return; }
      const transaction = legacyDb.transaction('audio', 'readonly');
      const getAll = transaction.objectStore('audio').getAll();
      getAll.onerror = () => { legacyDb.close(); resolve(empty); };
      getAll.onsuccess = () => {
        const rows = getAll.result as Array<Record<string, unknown>>;
        const files: AudioFileRecord[] = [];
        const tracks: TrackRecord[] = [];
        rows.forEach((item) => {
          const blob = item.blob instanceof Blob ? item.blob : item.file instanceof Blob ? item.file : null;
          const id = typeof item.id === 'string' ? item.id : '';
          if (!id || !blob) return;
          const legacyTrack = normalizeLegacyTrack(item.track);
          const name = legacyTrack?.title || (typeof item.name === 'string' ? item.name : `Local track ${id.slice(-5)}`);
          files.push({ id, name, type: typeof item.type === 'string' ? item.type : blob.type || 'audio/*', size: typeof item.size === 'number' ? item.size : blob.size, lastModified: typeof item.lastModified === 'number' ? item.lastModified : Date.now(), blob });
          tracks.push({ ...(legacyTrack ?? { id, title: name, artist: 'On this device', kind: 'local', source: 'local' }), id, kind: 'local', source: 'local', fileId: id, addedAt: Date.now() });
        });
        legacyDb.close();
        resolve({ files, tracks });
      };
    };
  });
}

export async function migrateLegacyStorage(): Promise<void> {
  await db.open();
  if (await db.settings.get(MIGRATION_KEY)) return;
  const now = Date.now();
  const liked = readLegacy<unknown[]>('liked', []).map(normalizeLegacyTrack).filter((track): track is TrackRecord => track !== null);
  const recent = readLegacy<unknown[]>('recent', []).map(normalizeLegacyTrack).filter((track): track is TrackRecord => track !== null);
  const queue = readLegacy<unknown[]>('queue', []).map(normalizeLegacyTrack).filter((track): track is TrackRecord => track !== null);
  const localSongs = readLegacy<unknown[]>('localSongs', []).map(normalizeLegacyTrack).filter((track): track is TrackRecord => track !== null);
  const legacyPlaylists = readLegacy<Array<{ id?: string; name?: string; tracks?: unknown[] }>>('playlists', []);
  const legacyAudio = await readLegacyAudioFiles();
  const fileRecords = legacyAudio.files;

  const merged = new Map<string, TrackRecord>();
  [...queue, ...recent, ...localSongs, ...legacyAudio.tracks, ...liked].forEach((track) => merged.set(track.id, { ...merged.get(track.id), ...track }));
  recent.forEach((track, index) => merged.set(track.id, { ...merged.get(track.id)!, lastPlayedAt: now - index, playCount: 1 }));
  liked.forEach((track, index) => merged.set(track.id, { ...merged.get(track.id)!, likedAt: now - index }));
  legacyPlaylists.forEach((playlist) => playlist.tracks?.map(normalizeLegacyTrack).filter((track): track is TrackRecord => track !== null).forEach((track) => merged.set(track.id, { ...track, ...merged.get(track.id) })));

  await db.transaction('rw', [db.tracks, db.playlists, db.playlistTracks, db.files, db.history, db.settings], async () => {
    // Recheck under the settings-store write lock so a second tab cannot import twice.
    if (await db.settings.get(MIGRATION_KEY)) return;
    if (merged.size) await db.tracks.bulkPut([...merged.values()]);
    if (fileRecords.length) await db.files.bulkPut(fileRecords);
    if (recent.length) await db.history.bulkAdd(recent.map((track, index) => ({ trackId: track.id, playedAt: now - index })));
    for (const [playlistIndex, legacy] of legacyPlaylists.entries()) {
      const id = legacy.id || `legacy-${now}-${playlistIndex}`;
      const tracks = (legacy.tracks ?? []).map(normalizeLegacyTrack).filter((track): track is TrackRecord => track !== null);
      await db.playlists.put({ id, name: legacy.name?.trim() || 'Untitled playlist', createdAt: now, updatedAt: now });
      if (tracks.length) await db.playlistTracks.bulkAdd(tracks.map((track, position) => ({ playlistId: id, trackId: track.id, position, addedAt: now })));
    }
    const appearance = {
      ...DEFAULT_APPEARANCE,
      style: readLegacy<string>('style', readLegacy<string>('styleChoice', 'glass')) === 'material' ? 'material' as const : 'glass' as const,
    };
    await db.settings.bulkPut([
      { key: 'appearance', value: appearance, updatedAt: now },
      { key: 'playback', value: { ...DEFAULT_PLAYBACK_SETTINGS, autoplay: readLegacy('autoplay', true) }, updatedAt: now },
      { key: 'queue', value: { tracks: queue, index: readLegacy('index', queue.length ? 0 : -1) }, updatedAt: now },
      { key: 'shuffle', value: readLegacy('shuffle', false), updatedAt: now },
      { key: 'repeat', value: readLegacy('repeat', 'off'), updatedAt: now },
      { key: 'room', value: { username: readLegacy('roomUsername', 'Listener'), server: readLegacy('roomServer', 'wss://metroserverx.meowery.eu/ws') }, updatedAt: now },
      { key: 'onboarding.complete', value: readLegacy('styleChosen', false), updatedAt: now },
      { key: MIGRATION_KEY, value: { completedAt: now, tracks: merged.size, files: fileRecords.length }, updatedAt: now },
    ]);
  });
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const record = await db.settings.get(key);
  return (record?.value as T | undefined) ?? fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.settings.put({ key, value, updatedAt: Date.now() });
}

export async function hydratePlaylists(): Promise<LocalPlaylist[]> {
  const records = await db.playlists.orderBy('updatedAt').reverse().toArray();
  return Promise.all(records.map(async (playlist) => {
    const joins = await db.playlistTracks.where('playlistId').equals(playlist.id).sortBy('position');
    const tracks = (await Promise.all(joins.map((join) => db.tracks.get(join.trackId)))).filter((track): track is TrackRecord => Boolean(track));
    return { ...playlist, tracks };
  }));
}

export async function getAppearance(): Promise<AppearanceSettings> {
  return { ...DEFAULT_APPEARANCE, ...await getSetting<Partial<AppearanceSettings>>('appearance', {}) };
}

export async function getPlaybackSettings(): Promise<PlaybackSettings> {
  return { ...DEFAULT_PLAYBACK_SETTINGS, ...await getSetting<Partial<PlaybackSettings>>('playback', {}) };
}
