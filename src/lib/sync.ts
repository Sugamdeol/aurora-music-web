import { db, getSetting, setSetting, type HistoryRecord, type TrackRecord } from './db';
import { useLibraryStore } from '../store/library';

// Deletions travel as tombstones — a union-only merge resurrects anything one
// device deleted (the classic multi-device sync bug). Tombstones expire after
// 30 days, long after any device plausibly re-syncs.
interface Tombstone { id: string; deletedAt: number }
const TOMBSTONE_KEY = 'sync.tombstones';
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface SyncSnapshot {
  tracks: Array<TrackRecord & { source: 'remote' }>;
  playlists: Array<{ id: string; name: string; description?: string; artwork?: string; createdAt: number; updatedAt: number; trackIds: string[] }>;
  history: Array<Omit<HistoryRecord, 'id'>>;
  settings: { appearance?: Record<string, unknown>; playback?: Record<string, unknown> };
  settingsUpdatedAt?: { appearance?: number; playback?: number };
  tombstones?: Tombstone[];
}
interface SyncAccount { username: string }
const base = '/api/v1/sync';
let syncInProgress = false;
let suppressPushUntil = 0;
let debounceTimer = 0;
let pullTimer = 0;
let automaticUnsubscribe: (() => void) | undefined;

export async function recordDeletion(id: string): Promise<void> {
  const existing = await getSetting<Tombstone[]>(TOMBSTONE_KEY, []);
  const fresh = existing.filter((item) => item.id !== id && Date.now() - item.deletedAt < TOMBSTONE_TTL_MS);
  fresh.push({ id, deletedAt: Date.now() });
  await setSetting(TOMBSTONE_KEY, fresh.slice(-200));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, { credentials: 'same-origin', ...init, headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } | string };
  if (!response.ok) {
    const err = typeof payload.error === 'string' ? payload.error : payload.error?.message;
    throw new Error(err || `Sync failed (${response.status}).`);
  }
  return payload as T;
}

export async function getSyncStatus(): Promise<boolean> {
  const result = await request<{ configured: boolean }>('/status');
  return result.configured;
}
export async function currentSyncAccount(): Promise<SyncAccount | null> { return (await request<{ user: SyncAccount | null }>('/me')).user; }
export async function authenticateSync(username: string, password: string, mode: 'login'|'register'): Promise<SyncAccount> {
  return request<SyncAccount>(`/${mode}`, { method: 'POST', body: JSON.stringify({ username, password }) });
}
export async function logoutSync(): Promise<void> { await request('/logout', { method: 'POST' }); }

function remoteTrack(track: TrackRecord): TrackRecord & { source: 'remote' } {
  const { streamUrl: _streamUrl, fileId: _fileId, ...safe } = track;
  return { ...safe, kind: track.kind === 'video' ? 'video' : 'song', source: 'remote' };
}
async function localSnapshot(): Promise<SyncSnapshot> {
  const [tracks, playlists, joins, history, appearance, playback, tombstones] = await Promise.all([
    db.tracks.toArray(), db.playlists.toArray(), db.playlistTracks.toArray(), db.history.orderBy('playedAt').reverse().limit(500).toArray(),
    db.settings.get('appearance'), db.settings.get('playback'), getSetting<Tombstone[]>(TOMBSTONE_KEY, []),
  ]);
  // Sync tracks the listener actually owns: liked, played, or referenced by a
  // playlist — not every track that ever passed through the queue.
  const inPlaylist = new Set(joins.map((join) => join.trackId));
  const eligible = tracks.filter((track) => track.source === 'remote' && (track.likedAt || track.lastPlayedAt || inPlaylist.has(track.id)));
  const byPlaylist = new Map<string, typeof joins>();
  for (const join of joins) byPlaylist.set(join.playlistId, [...(byPlaylist.get(join.playlistId) ?? []), join]);
  return {
    tracks: eligible.slice(0, 500).map(remoteTrack),
    playlists: playlists.slice(0, 100).map(({ id, name, description, artwork, createdAt, updatedAt }) => ({ id, name, description, artwork, createdAt, updatedAt, trackIds: (byPlaylist.get(id) ?? []).sort((a,b)=>a.position-b.position).map((join)=>join.trackId).slice(0,500) })),
    history: history.map(({ id: _id, ...item }) => item),
    settings: { appearance: (appearance?.value as Record<string, unknown> | undefined), playback: (playback?.value as Record<string, unknown> | undefined) },
    settingsUpdatedAt: { appearance: appearance?.updatedAt ?? 0, playback: playback?.updatedAt ?? 0 },
    tombstones: tombstones.filter((item) => Date.now() - item.deletedAt < TOMBSTONE_TTL_MS),
  };
}

async function writeMergedSnapshot(cloud: SyncSnapshot): Promise<void> {
  const local = await localSnapshot();
  const tracks = new Map<string, TrackRecord>();
  for (const track of cloud.tracks ?? []) tracks.set(track.id, track);
  for (const track of local.tracks) {
    const old = tracks.get(track.id);
    const likedAt = Math.max(old?.likedAt ?? 0, track.likedAt ?? 0);
    const unlikedAt = Math.max(old?.unlikedAt ?? 0, track.unlikedAt ?? 0);
    tracks.set(track.id, { ...old, ...track, likedAt: unlikedAt > likedAt ? undefined : likedAt || undefined, unlikedAt: Math.max(old?.unlikedAt ?? 0, track.unlikedAt ?? 0) || undefined, lastPlayedAt: Math.max(old?.lastPlayedAt ?? 0, track.lastPlayedAt ?? 0) || undefined });
  }
  const playlists = new Map<string, SyncSnapshot['playlists'][number]>();
  for (const playlist of cloud.playlists ?? []) playlists.set(playlist.id, playlist);
  for (const playlist of local.playlists) {
    const old = playlists.get(playlist.id);
    playlists.set(playlist.id, old ? (old.updatedAt > playlist.updatedAt ? old : playlist) : playlist);
  }
  const historyMap = new Map<string, Omit<HistoryRecord, 'id'>>();
  for (const item of [...(cloud.history ?? []), ...local.history]) historyMap.set(`${item.trackId}:${item.playedAt}`, item);
  // Newest deletion wins over any device's older playlist copy.
  const tombstones = new Map<string, number>();
  for (const item of [...(cloud.tombstones ?? []), ...(local.tombstones ?? [])]) tombstones.set(item.id, Math.max(item.deletedAt, tombstones.get(item.id) ?? 0));
  for (const [id, deletedAt] of tombstones) {
    const playlist = playlists.get(id);
    if (playlist && deletedAt > playlist.updatedAt) playlists.delete(id);
  }
  const settings: SyncSnapshot['settings'] = {};
  const settingsUpdatedAt: NonNullable<SyncSnapshot['settingsUpdatedAt']> = {};
  for (const key of ['appearance', 'playback'] as const) {
    const cloudTime = cloud.settingsUpdatedAt?.[key] ?? 0;
    const localTime = local.settingsUpdatedAt?.[key] ?? 0;
    const useCloud = cloud.settings?.[key] !== undefined && (!local.settings[key] || cloudTime > localTime);
    settings[key] = useCloud ? cloud.settings[key] : local.settings[key];
    settingsUpdatedAt[key] = useCloud ? cloudTime : localTime;
  }
  const merged: SyncSnapshot = { tracks: [...tracks.values()].slice(-500).map(remoteTrack), playlists: [...playlists.values()].slice(0,100), history: [...historyMap.values()].sort((a,b)=>b.playedAt-a.playedAt).slice(0,500), settings, settingsUpdatedAt, tombstones: [...tombstones.entries()].map(([id, deletedAt]) => ({ id, deletedAt })) };
  const remoteIds = new Set(merged.tracks.map((track) => track.id));
  const survivingIds = new Set(merged.playlists.map((playlist) => playlist.id));
  const oldHist = await db.history.toArray();
  await db.transaction('rw', db.tracks, db.playlists, db.playlistTracks, db.history, db.settings, async () => {
    await db.tracks.bulkPut(merged.tracks);
    // A playlist deleted on another device disappears here too.
    for (const [id, deletedAt] of tombstones) {
      if (survivingIds.has(id)) continue;
      const localPlaylist = await db.playlists.get(id);
      if (localPlaylist && deletedAt > localPlaylist.updatedAt) {
        await db.playlists.delete(id);
        await db.playlistTracks.where('playlistId').equals(id).delete();
      }
    }
    for (const playlist of merged.playlists) {
      const current = await db.playlists.get(playlist.id);
      await db.playlists.put({ id: playlist.id, name: playlist.name, description: playlist.description, artwork: playlist.artwork, createdAt: current?.createdAt ?? playlist.createdAt, updatedAt: Math.max(current?.updatedAt ?? 0, playlist.updatedAt) });
      // The winning snapshot owns remote membership and order. Preserve
      // local-only files, which cannot travel between devices.
      const joins = await db.playlistTracks.where('playlistId').equals(playlist.id).sortBy('position');
      const localJoins = [];
      for (const join of joins) {
        if ((await db.tracks.get(join.trackId))?.source === 'local') localJoins.push(join);
      }
      await db.playlistTracks.where('playlistId').equals(playlist.id).delete();
      const trackIds = [...new Set(playlist.trackIds.filter((id) => remoteIds.has(id)))];
      const rebuilt = trackIds.map((trackId, position) => ({ playlistId: playlist.id, trackId, position, addedAt: Date.now() }));
      rebuilt.push(...localJoins.map((join, index) => ({ playlistId: playlist.id, trackId: join.trackId, position: trackIds.length + index, addedAt: join.addedAt })));
      if (rebuilt.length) await db.playlistTracks.bulkAdd(rebuilt);
    }
    const existing = new Set(oldHist.map((item)=>`${item.trackId}:${item.playedAt}`));
    const history = merged.history.filter((item)=>!existing.has(`${item.trackId}:${item.playedAt}`));
    if (history.length) await db.history.bulkAdd(history);
    for (const key of ['appearance','playback'] as const) if (merged.settings[key]) await db.settings.put({ key, value: merged.settings[key], updatedAt: merged.settingsUpdatedAt?.[key] ?? 0 });
    await db.settings.put({ key: TOMBSTONE_KEY, value: (merged.tombstones ?? []).filter((item) => Date.now() - item.deletedAt < TOMBSTONE_TTL_MS), updatedAt: Date.now() });
  });
  await useLibraryStore.getState().bootstrap();
}

export async function syncLibrary(): Promise<void> {
  if (syncInProgress) return;
  syncInProgress = true;
  suppressPushUntil = Date.now() + 5000;
  try {
    const response = await request<{ snapshot: SyncSnapshot }>('/data');
    await writeMergedSnapshot(response.snapshot ?? { tracks: [], playlists: [], history: [], settings: {} });
    const snapshot = await localSnapshot();
    await request('/data', { method: 'PUT', body: JSON.stringify(snapshot) });
  } finally { syncInProgress = false; }
}

export function enableAutomaticSync(): void {
  if (automaticUnsubscribe) return;
  const subscribe = useLibraryStore.subscribe((state, previous) => {
    if (syncInProgress || Date.now() < suppressPushUntil || !state.ready) return;
    if (state.likedTracks === previous.likedTracks && state.recent === previous.recent && state.playlists === previous.playlists && state.appearance === previous.appearance && state.playbackSettings === previous.playbackSettings) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => { void syncLibrary().catch((error)=>console.warn('Aurora account sync paused:',error)); }, 1800);
  });
  // Pushing alone leaves long-lived tabs behind other devices. Pull on focus /
  // reconnect / every 5 minutes so changes made elsewhere actually arrive.
  const pull = () => {
    if (syncInProgress) return;
    window.clearTimeout(pullTimer);
    pullTimer = window.setTimeout(() => { void syncLibrary().catch((error) => console.warn('Aurora account sync paused:', error)); }, 400);
  };
  const onFocus = () => { if (document.visibilityState !== 'hidden') pull(); };
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', pull);
  document.addEventListener('visibilitychange', onFocus);
  const interval = window.setInterval(pull, 5 * 60_000);
  automaticUnsubscribe = () => {
    subscribe();
    window.clearTimeout(debounceTimer);
    window.clearTimeout(pullTimer);
    window.clearInterval(interval);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', pull);
    document.removeEventListener('visibilitychange', onFocus);
    automaticUnsubscribe = undefined;
  };
}
export function disableAutomaticSync(): void { automaticUnsubscribe?.(); }
