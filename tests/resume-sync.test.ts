import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getSetting, setSetting } from '../src/lib/db';
import { usePlaybackStore } from '../src/store/playback';
import { syncLibrary } from '../src/lib/sync';
import type { MediaTrack } from '../src/domain/media';

const tracks: MediaTrack[] = ['a', 'b', 'c'].map(id => ({ id, title: id, artist: 'Artist', source: 'remote', kind: 'song', durationSeconds: 200 }));
beforeEach(async () => {
  await Promise.all([db.settings.clear(), db.tracks.clear(), db.playlists.clear(), db.playlistTracks.clear(), db.history.clear()]);
  usePlaybackStore.setState({ queue: [], currentTrack: null, currentIndex: -1, position: 0, duration: 0, isPlaying: false });
});
afterEach(async () => { if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(5000); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('resume and sync regressions', () => {
  it('saves a resume point while time updates continue and rejects another track’s position', async () => {
    vi.useFakeTimers();
    usePlaybackStore.getState().playTracks(tracks);
    for (let second = 1; second <= 8; second++) {
      usePlaybackStore.getState().setPosition(second);
      await vi.advanceTimersByTimeAsync(1000);
    }
    vi.useRealTimers();
    expect(await getSetting('queue.position', null)).toEqual({ trackId: 'a', position: 8 });
    await setSetting('queue', { tracks, index: 1, position: 0 });
    await usePlaybackStore.getState().bootstrap();
    expect(usePlaybackStore.getState().position).toBe(0);
  });
  it('keeps a local file reference and resets the clock when removing the playing song', async () => {
    vi.useFakeTimers();
    usePlaybackStore.getState().playTracks([{ ...tracks[0], source: 'local', kind: 'local', fileId: 'different-file-id' }, tracks[1]]);
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    expect((await getSetting<{ tracks: MediaTrack[] }>('queue', { tracks: [] })).tracks[0].fileId).toBe('different-file-id');
    usePlaybackStore.getState().seek(80);
    usePlaybackStore.getState().removeFromQueue(0);
    expect(usePlaybackStore.getState()).toMatchObject({ currentTrack: tracks[1], position: 0, duration: 200, status: 'loading' });
  });
  it('compacts repeated history metadata and restores it on another device', async () => {
    await db.tracks.put({ ...tracks[0], artwork: 'https://example.com/' + 'x'.repeat(500), likedAt: 1 });
    await db.history.bulkAdd(Array.from({ length: 200 }, (_, index) => ({ trackId: 'a', playedAt: index + 1, listenedSeconds: 100, artist: 'Artist', trackTitle: 'a', artwork: 'https://example.com/' + 'x'.repeat(500) })));
    let pushed: any;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (init?.method === 'PUT') { pushed = JSON.parse(init.body); return new Response('{}'); }
      return new Response(JSON.stringify({ snapshot: { tracks: [], playlists: [], history: [], settings: {} } }));
    }));
    await syncLibrary();
    expect(pushed.history).toHaveLength(200);
    expect(pushed.history[0].artwork).toBeUndefined();
    expect((await db.history.toArray())[0].artwork).toContain('example.com');
    const cloud = pushed;
    await db.history.clear(); await db.tracks.clear();
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => new Response(init?.method === 'PUT' ? '{}' : JSON.stringify({ snapshot: cloud }))));
    await syncLibrary();
    expect((await db.history.toArray())[0]).toMatchObject({ artist: 'Artist', trackTitle: 'a', listenedSeconds: 100 });
    expect((await db.history.toArray())[0].artwork).toContain('example.com');
  });
  it('syncs remote removals and order, preserves local files, and chooses newer settings', async () => {
    await db.tracks.bulkPut([...tracks, { ...tracks[0], id: 'local', kind: 'local', source: 'local' }]);
    await db.playlists.put({ id: 'p', name: 'Mix', createdAt: 1, updatedAt: 1 });
    await db.playlistTracks.bulkAdd(['a','b','c','local'].map((trackId, position) => ({ playlistId: 'p', trackId, position, addedAt: 1 })));
    await setSetting('migration.legacy-v1', true);
    await db.settings.put({ key: 'playback', value: { autoplay: false }, updatedAt: 300 });
    const cloud = { tracks, playlists: [{ id: 'p', name: 'Mix', createdAt: 1, updatedAt: 200, trackIds: ['c','a'] }], history: [], settings: { playback: { autoplay: true } }, settingsUpdatedAt: { playback: 100 } };
    let pushed: any;
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      if (init?.method === 'PUT') { pushed = JSON.parse(init.body); return new Response('{}'); }
      return new Response(JSON.stringify({ snapshot: cloud }));
    }));
    await syncLibrary();
    expect((await db.playlistTracks.where('playlistId').equals('p').sortBy('position')).map(join => join.trackId)).toEqual(['c','a','local']);
    expect(pushed.settings.playback.autoplay).toBe(false);
    expect(pushed.settingsUpdatedAt.playback).toBe(300);
    cloud.settingsUpdatedAt.playback = 400;
    await syncLibrary();
    expect((await db.settings.get('playback'))?.value).toEqual({ autoplay: true });
  });
});

