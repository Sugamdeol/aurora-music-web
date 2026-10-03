// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import type { AudioExtractor } from '../server/services/ytdlp';
import type { MusicProvider } from '../server/services/youtube';

const records = new Map<string, unknown>();
const audio = { readiness: async () => ({ ready: true }) } as unknown as AudioExtractor;
const app = createApp({ music: {} as MusicProvider, audio });
const mantleFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const path = new URL(String(url)).pathname.split('/').slice(4).join('/');
  if (init?.method === 'POST') { records.set(path, JSON.parse(String(init.body))); return new Response(JSON.stringify({ success: true }), { status: 200 }); }
  const value = records.get(path);
  return value ? new Response(JSON.stringify(value), { status: 200 }) : new Response('{}', { status: 404 });
});

afterEach(() => { vi.unstubAllGlobals(); records.clear(); delete process.env.MANTLEDB_NAMESPACE; delete process.env.MANTLEDB_KEY; });

describe('optional MantleDB account sync', () => {
  it('creates a salted password hash, keeps sync data private, and restores it only after login', async () => {
    process.env.MANTLEDB_NAMESPACE = 'aurora-test'; process.env.MANTLEDB_KEY = 'a-test-secret-key';
    vi.stubGlobal('fetch', mantleFetch);
    const client = request.agent(app);
    const created = await client.post('/api/v1/sync/register').send({ username: 'mix_user', password: 'a secure test password' });
    expect(created.status).toBe(200);
    const stored = [...records.values()][0] as { salt: string; passwordHash: string; snapshot: { tracks: unknown[] } };
    expect(stored.salt).not.toBe('');
    expect(stored.passwordHash).not.toContain('a secure test password');
    expect(stored.snapshot.tracks).toEqual([]);

    const snapshot = { tracks: [{ id: 'song_01', title: 'Song', artist: 'Artist', source: 'remote', kind: 'song' }], playlists: [], history: [], settings: {} };
    const saved = await client.put('/api/v1/sync/data').send(snapshot);
    expect(saved.status).toBe(200);
    expect((await client.get('/api/v1/sync/data')).body.snapshot.tracks).toHaveLength(1);

    const otherClient = request.agent(app);
    expect((await otherClient.get('/api/v1/sync/data')).status).toBe(401);
    expect((await otherClient.post('/api/v1/sync/login').send({ username: 'mix_user', password: 'incorrect password' })).status).toBe(401);
    expect((await otherClient.post('/api/v1/sync/login').send({ username: 'mix_user', password: 'a secure test password' })).status).toBe(200);
    expect((await otherClient.get('/api/v1/sync/data')).body.snapshot.tracks).toHaveLength(1);
  });

  it('reports disabled cleanly if the server has no MantleDB configuration', async () => {
    const response = await request(app).get('/api/v1/sync/status');
    expect(response.status).toBe(200);
    expect(response.body.configured).toBe(false);
  });
});


describe('sync error recovery', () => {
  it('reports oversized uploads without a generic internal error', async () => {
    const response = await request(app).put('/api/v1/sync/data').send({ padding: 'x'.repeat(70_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('SYNC_TOO_LARGE');
    expect(response.body.error.message).toContain('local library is safe');
  });
  it('reports storage timeouts and does not overwrite the stored account', async () => {
    process.env.MANTLEDB_NAMESPACE = 'aurora-test'; process.env.MANTLEDB_KEY = 'a-test-secret-key';
    vi.stubGlobal('fetch', mantleFetch);
    const client = request.agent(app);
    await client.post('/api/v1/sync/register').send({ username: 'timeout_user', password: 'a secure test password' });
    const before = JSON.stringify([...records.values()]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')));
    const response = await client.get('/api/v1/sync/data');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SYNC_STORAGE_ERROR');
    expect(response.body.error.message).toContain('local library is safe');
    expect(JSON.stringify([...records.values()])).toBe(before);
  });
  it('reports unreadable storage responses clearly', async () => {
    process.env.MANTLEDB_NAMESPACE = 'aurora-test'; process.env.MANTLEDB_KEY = 'a-test-secret-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid json', { status: 200 })));
    const response = await request(app).post('/api/v1/sync/login').send({ username: 'broken_user', password: 'a secure test password' });
    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe('SYNC_STORAGE_ERROR');
  });
});
