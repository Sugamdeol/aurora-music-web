import { create } from 'zustand';
import type { AppearanceSettings, LocalPlaylist, MediaTrack, PlaybackSettings } from '../domain/media';
import { DEFAULT_APPEARANCE, DEFAULT_PLAYBACK_SETTINGS } from '../domain/media';
import {
  db,
  getAppearance,
  getPlaybackSettings,
  hydratePlaylists,
  migrateLegacyStorage,
  setSetting,
  type TrackRecord,
} from '../lib/db';
import { usePlaybackStore } from './playback';
import { safeEqualizerGains } from '../lib/equalizer';

interface LibraryState {
  ready: boolean;
  error?: string;
  likedIds: Set<string>;
  likedTracks: MediaTrack[];
  recent: MediaTrack[];
  localTracks: MediaTrack[];
  playlists: LocalPlaylist[];
  appearance: AppearanceSettings;
  playbackSettings: PlaybackSettings;
  bootstrap: () => Promise<void>;
  toggleLike: (track: MediaTrack) => Promise<void>;
  recordPlay: (track: MediaTrack) => Promise<number>;
  recordListenTime: (historyId: number, seconds: number) => Promise<void>;
  createPlaylist: (name: string) => Promise<LocalPlaylist>;
  createPlaylistFromTracks: (name: string, tracks: MediaTrack[]) => Promise<LocalPlaylist>;
  deletePlaylist: (id: string) => Promise<void>;
  addToPlaylist: (playlistId: string, track: MediaTrack) => Promise<void>;
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>;
  editPlaylist: (playlistId: string, name: string, description: string) => Promise<void>;
  reorderPlaylist: (playlistId: string, from: number, to: number) => Promise<void>;
  importFiles: (files: File[]) => Promise<MediaTrack[]>;
  removeLocalTrack: (id: string) => Promise<void>;
  updateAppearance: (patch: Partial<AppearanceSettings>) => Promise<void>;
  updatePlaybackSettings: (patch: Partial<PlaybackSettings>) => Promise<void>;
}

const toTrack = (track: TrackRecord): MediaTrack => ({ ...track });
const safeId = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled local track';
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  ready: false,
  likedIds: new Set(),
  likedTracks: [],
  recent: [],
  localTracks: [],
  playlists: [],
  appearance: DEFAULT_APPEARANCE,
  playbackSettings: DEFAULT_PLAYBACK_SETTINGS,

  bootstrap: async () => {
    try {
      await migrateLegacyStorage();
      const [liked, recentRecords, localTracks, playlists, appearance, playbackSettings] = await Promise.all([
        db.tracks.where('likedAt').above(0).reverse().sortBy('likedAt'),
        db.tracks.where('lastPlayedAt').above(0).reverse().sortBy('lastPlayedAt'),
        db.tracks.where('source').equals('local').toArray(),
        hydratePlaylists(),
        getAppearance(),
        getPlaybackSettings(),
      ]);
      set({
        ready: true,
        likedIds: new Set(liked.map((track) => track.id)),
        likedTracks: liked.map(toTrack),
        recent: recentRecords.slice(0, 100).map(toTrack),
        localTracks: localTracks.map(toTrack),
        playlists,
        appearance,
        playbackSettings,
      });
    } catch (error) {
      set({ ready: true, error: error instanceof Error ? error.message : 'Your library could not be opened.' });
    }
  },

  toggleLike: async (track) => {
    const liked = new Set(get().likedIds);
    const nowLiked = !liked.has(track.id);
    nowLiked ? liked.add(track.id) : liked.delete(track.id);
    set((state) => ({ likedIds: liked, likedTracks: nowLiked ? [track, ...state.likedTracks.filter((item) => item.id !== track.id)] : state.likedTracks.filter((item) => item.id !== track.id) }));
    const existing = await db.tracks.get(track.id);
    await db.tracks.put({ ...existing, ...track, likedAt: nowLiked ? Date.now() : undefined });
  },

  recordPlay: async (track) => {
    const now = Date.now();
    const existing = await db.tracks.get(track.id);
    const record: TrackRecord = { ...existing, ...track, lastPlayedAt: now, playCount: (existing?.playCount ?? 0) + 1 };
    let historyId = 0;
    await db.transaction('rw', db.tracks, db.history, async () => {
      await db.tracks.put(record);
      historyId = (await db.history.add({ trackId: track.id, playedAt: now, trackTitle: track.title, artist: track.artist, artwork: track.artwork })) ?? 0;
    });
    set((state) => ({ recent: [track, ...state.recent.filter((item) => item.id !== track.id)].slice(0, 100) }));
    return historyId;
  },

  recordListenTime: async (historyId, seconds) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    await db.transaction('rw', db.history, async () => {
      const record = await db.history.get(historyId);
      if (record) await db.history.update(historyId, { listenedSeconds: (record.listenedSeconds ?? 0) + seconds });
    });
  },

  createPlaylist: async (rawName) => {
    const name = rawName.trim().slice(0, 64);
    if (!name) throw new Error('Enter a playlist name.');
    const now = Date.now();
    const playlist: LocalPlaylist = { id: safeId(), name, createdAt: now, updatedAt: now, tracks: [] };
    await db.playlists.put(playlist);
    set((state) => ({ playlists: [playlist, ...state.playlists] }));
    return playlist;
  },

  createPlaylistFromTracks: async (rawName, tracks) => {
    const name = rawName.trim().slice(0, 64);
    if (!name) throw new Error('Enter a playlist name.');
    const seen = new Set<string>();
    const unique = tracks.filter((track) => !seen.has(track.id) && Boolean(seen.add(track.id)));
    if (!unique.length) throw new Error('Add a song before saving a playlist.');
    const now = Date.now();
    const playlist: LocalPlaylist = { id: safeId(), name, createdAt: now, updatedAt: now, artwork: unique[0].artwork, tracks: unique };
    await db.transaction('rw', db.tracks, db.playlists, db.playlistTracks, async () => {
      const existing = await db.tracks.bulkGet(unique.map((track) => track.id));
      await db.tracks.bulkPut(unique.map((track, index) => ({ ...existing[index], ...track })));
      const { tracks: _tracks, ...record } = playlist;
      await db.playlists.put(record);
      await db.playlistTracks.bulkAdd(unique.map((track, position) => ({ playlistId: playlist.id, trackId: track.id, position, addedAt: now })));
    });
    set((state) => ({ playlists: [playlist, ...state.playlists] }));
    return playlist;
  },

  deletePlaylist: async (id) => {
    await db.transaction('rw', db.playlists, db.playlistTracks, async () => {
      await db.playlists.delete(id);
      await db.playlistTracks.where('playlistId').equals(id).delete();
    });
    set((state) => ({ playlists: state.playlists.filter((playlist) => playlist.id !== id) }));
  },

  addToPlaylist: async (playlistId, track) => {
    const current = get().playlists.find((playlist) => playlist.id === playlistId);
    if (!current || current.tracks.some((item) => item.id === track.id)) return;
    const now = Date.now();
    await db.transaction('rw', db.tracks, db.playlistTracks, db.playlists, async () => {
      await db.tracks.put({ ...await db.tracks.get(track.id), ...track });
      await db.playlistTracks.add({ playlistId, trackId: track.id, position: current.tracks.length, addedAt: now });
      await db.playlists.update(playlistId, { updatedAt: now, artwork: current.artwork || track.artwork });
    });
    set((state) => ({ playlists: state.playlists.map((playlist) => playlist.id === playlistId
      ? { ...playlist, artwork: playlist.artwork || track.artwork, updatedAt: now, tracks: [...playlist.tracks, track] }
      : playlist) }));
  },

  removeFromPlaylist: async (playlistId, trackId) => {
    await db.playlistTracks.where('[playlistId+trackId]').equals([playlistId, trackId]).delete();
    const joins = await db.playlistTracks.where('playlistId').equals(playlistId).sortBy('position');
    await db.transaction('rw', db.playlistTracks, db.playlists, async () => {
      await Promise.all(joins.map((join, position) => join.id == null ? undefined : db.playlistTracks.update(join.id, { position })));
      await db.playlists.update(playlistId, { updatedAt: Date.now() });
    });
    set((state) => ({ playlists: state.playlists.map((playlist) => playlist.id === playlistId
      ? { ...playlist, tracks: playlist.tracks.filter((track) => track.id !== trackId), updatedAt: Date.now() }
      : playlist) }));
  },

  editPlaylist: async (playlistId, rawName, description) => {
    const name = rawName.trim().slice(0, 64);
    if (!name) throw new Error('Enter a playlist name.');
    const patch = { name, description: description.trim().slice(0, 400), updatedAt: Date.now() };
    if (!await db.playlists.update(playlistId, patch)) throw new Error('This playlist no longer exists.');
    set((state) => ({ playlists: state.playlists.map((playlist) => playlist.id === playlistId ? { ...playlist, ...patch } : playlist) }));
  },

  reorderPlaylist: async (playlistId, from, to) => {
    const playlist = get().playlists.find((item) => item.id === playlistId);
    if (!playlist || !Number.isInteger(from) || !Number.isInteger(to) || from === to || from < 0 || to < 0 || from >= playlist.tracks.length || to >= playlist.tracks.length) return;
    const tracks = [...playlist.tracks];
    const [moved] = tracks.splice(from, 1);
    tracks.splice(to, 0, moved);
    const updatedAt = Date.now();
    await db.transaction('rw', db.playlistTracks, db.playlists, async () => {
      const joins = await db.playlistTracks.where('playlistId').equals(playlistId).toArray();
      const positions = new Map(tracks.map((track, index) => [track.id, index]));
      await Promise.all(joins.map((join) => join.id === undefined ? undefined : db.playlistTracks.update(join.id, { position: positions.get(join.trackId) ?? join.position })));
      await db.playlists.update(playlistId, { updatedAt });
    });
    set((state) => ({ playlists: state.playlists.map((item) => item.id === playlistId ? { ...item, tracks, updatedAt } : item) }));
  },

  importFiles: async (files) => {
    const accepted = files.filter((file) => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus|webm)$/i.test(file.name));
    const imported = accepted.map((file) => {
      const id = `local-${safeId()}`;
      return {
        track: {
          id,
          kind: 'local' as const,
          title: titleFromFilename(file.name),
          artist: 'On this device',
          source: 'local' as const,
          fileId: id,
          addedAt: Date.now(),
        },
        file,
      };
    });
    await db.transaction('rw', db.tracks, db.files, async () => {
      await db.tracks.bulkPut(imported.map(({ track }) => track));
      await db.files.bulkPut(imported.map(({ track, file }) => ({
        id: track.id,
        name: file.name,
        type: file.type || 'audio/*',
        size: file.size,
        lastModified: file.lastModified,
        blob: file,
      })));
    });
    const tracks = imported.map(({ track }) => track);
    set((state) => ({ localTracks: [...tracks, ...state.localTracks] }));
    return tracks;
  },

  removeLocalTrack: async (id) => {
    await db.transaction('rw', db.tracks, db.files, db.playlistTracks, db.history, async () => {
      await db.tracks.delete(id);
      await db.files.delete(id);
      await db.playlistTracks.where('trackId').equals(id).delete();
      await db.history.where('trackId').equals(id).delete();
    });
    set((state) => {
      const likedIds = new Set(state.likedIds); likedIds.delete(id);
      return {
        likedIds,
        likedTracks: state.likedTracks.filter((track) => track.id !== id),
        recent: state.recent.filter((track) => track.id !== id),
        localTracks: state.localTracks.filter((track) => track.id !== id),
        playlists: state.playlists.map((playlist) => ({ ...playlist, tracks: playlist.tracks.filter((track) => track.id !== id) })),
      };
    });
    const playback = usePlaybackStore.getState();
    for (let index = playback.queue.length - 1; index >= 0; index -= 1) if (playback.queue[index]?.id === id) usePlaybackStore.getState().removeFromQueue(index);
  },

  updateAppearance: async (patch) => {
    const appearance = { ...get().appearance, ...patch };
    set({ appearance });
    await setSetting('appearance', appearance);
  },

  updatePlaybackSettings: async (patch) => {
    const playbackSettings = { ...get().playbackSettings, ...patch, equalizerGains: safeEqualizerGains(patch.equalizerGains ?? get().playbackSettings.equalizerGains) };
    set({ playbackSettings });
    await setSetting('playback', playbackSettings);
  },
}));
