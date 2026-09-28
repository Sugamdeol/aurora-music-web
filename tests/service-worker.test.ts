import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { beforeEach, describe, expect, it, vi } from 'vitest';

type WorkerListener = (event: Record<string, unknown>) => void;

const workerSource = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

const createWorkerHarness = () => {
  const listeners = new Map<string, WorkerListener>();
  const cachedShell = { source: 'cached-shell' };
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(true),
    keys: vi.fn().mockResolvedValue([]),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const cacheStorage = {
    delete: vi.fn().mockResolvedValue(true),
    keys: vi.fn().mockResolvedValue([]),
    match: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(cache),
  };
  const fetchMock = vi.fn();
  const skipWaiting = vi.fn();
  const postMessage = vi.fn();
  const workerSelf = {
    location: { origin: 'https://aurora.test' },
    registration: { active: null },
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([]),
    },
    skipWaiting,
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
  };

  runInNewContext(workerSource, {
    URL,
    Request,
    Promise,
    Set,
    caches: cacheStorage,
    fetch: fetchMock,
    self: workerSelf,
  });

  return {
    cache,
    cacheStorage,
    cachedShell,
    fetchMock,
    listeners,
    postMessage,
    skipWaiting,
  };
};

const dispatchFetch = async (
  listener: WorkerListener,
  request: Request | Record<string, unknown>,
) => {
  let responsePromise: Promise<unknown> | undefined;
  const backgroundWork: Promise<unknown>[] = [];
  listener({
    request,
    respondWith: (response: Promise<unknown>) => {
      responsePromise = response;
    },
    waitUntil: (work: Promise<unknown>) => backgroundWork.push(work),
  });
  const response = responsePromise ? await responsePromise : undefined;
  await Promise.all(backgroundWork);
  return response;
};

describe('service worker routing', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls back to the cached React shell for an offline route navigation', async () => {
    const harness = createWorkerHarness();
    harness.fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    harness.cacheStorage.match.mockResolvedValueOnce(harness.cachedShell);

    const response = await dispatchFetch(harness.listeners.get('fetch')!, {
      method: 'GET',
      mode: 'navigate',
      destination: 'document',
      headers: new Headers(),
      url: 'https://aurora.test/artist/example',
    });

    expect(response).toBe(harness.cachedShell);
    expect(harness.cacheStorage.match).toHaveBeenCalledWith(
      'https://aurora.test/',
      { ignoreSearch: true },
    );
  });

  it.each(['/api/search?q=aurora', '/stream/song-id', '/streams/song-id'])
  ('always fetches %s with the HTTP cache disabled', async (path) => {
    const harness = createWorkerHarness();
    const networkResponse = { ok: true };
    harness.fetchMock.mockResolvedValueOnce(networkResponse);
    const request = new Request(`https://aurora.test${path}`);

    const response = await dispatchFetch(harness.listeners.get('fetch')!, request);

    expect(response).toBe(networkResponse);
    expect(harness.fetchMock).toHaveBeenCalledWith(request, { cache: 'no-store' });
    expect(harness.cacheStorage.open).not.toHaveBeenCalled();
  });

  it('never caches range requests', async () => {
    const harness = createWorkerHarness();
    harness.fetchMock.mockResolvedValueOnce({ ok: true });
    const request = new Request('https://media.example/song', {
      headers: { Range: 'bytes=0-1023' },
    });

    await dispatchFetch(harness.listeners.get('fetch')!, request);

    expect(harness.fetchMock).toHaveBeenCalledWith(request, { cache: 'no-store' });
    expect(harness.cacheStorage.open).not.toHaveBeenCalled();
  });

  it('bounds the artwork cache to sixty entries', async () => {
    const harness = createWorkerHarness();
    const oldestArtwork = new Request('https://images.example/oldest.jpg');
    const cachedArtwork = Array.from(
      { length: 61 },
      (_, index) => index === 0 ? oldestArtwork : new Request(`https://images.example/${index}.jpg`),
    );
    const networkResponse = {
      ok: true,
      type: 'basic',
      headers: new Headers(),
      clone() {
        return this;
      },
    };
    harness.cache.keys.mockResolvedValueOnce(cachedArtwork);
    harness.fetchMock.mockResolvedValueOnce(networkResponse);
    const request = {
      method: 'GET',
      mode: 'cors',
      destination: 'image',
      headers: new Headers(),
      url: 'https://images.example/current.jpg',
    };

    await dispatchFetch(harness.listeners.get('fetch')!, request);

    expect(harness.cache.put).toHaveBeenCalledWith(request, networkResponse);
    expect(harness.cache.delete).toHaveBeenCalledWith(oldestArtwork);
  });
});

describe('service worker update lifecycle', () => {
  it('waits for explicit approval before activating an update', () => {
    const harness = createWorkerHarness();
    const message = harness.listeners.get('message')!;

    expect(harness.skipWaiting).not.toHaveBeenCalled();
    message({ data: { type: 'AURORA_SW_SKIP_WAITING' } });
    expect(harness.skipWaiting).toHaveBeenCalledOnce();
  });

  it('reports its version to a requesting client', () => {
    const harness = createWorkerHarness();
    const source = { postMessage: harness.postMessage };

    harness.listeners.get('message')!({
      data: { type: 'AURORA_SW_GET_VERSION' },
      source,
    });

    expect(harness.postMessage).toHaveBeenCalledWith({
      type: 'AURORA_SW_VERSION',
      version: '2026-09-28.1',
    });
  });
});
