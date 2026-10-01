// Bump on every release that ships this file or its precache list. The build
// does not rewrite this constant, so keep it in sync when touching sw.js.
const VERSION = '2026-09-28.2';
const CACHE_PREFIX = 'aurora-';
const SHELL_CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}static-${VERSION}`;
const ARTWORK_CACHE = `${CACHE_PREFIX}artwork-${VERSION}`;
const ROOT_URL = new URL('/', self.location.origin).toString();
const PRECACHE_URLS = [
  '/', '/aurora.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png',
  '/artwork/mood-slow-mornings.svg', '/artwork/mood-deep-focus.svg',
  '/artwork/mood-after-hours.svg', '/artwork/mood-move.svg',
  '/artwork/mood-rainy-days.svg', '/artwork/mood-feel-good.svg',
];
const STATIC_CACHE_LIMIT = 40;
const ARTWORK_CACHE_LIMIT = 60;

const notifyClients = async (message) => {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
};

const trimCache = async (cacheName, maximumEntries) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - maximumEntries)).map((key) => cache.delete(key)));
};

const mayCache = (response) => {
  if (!(response.ok || response.type === 'opaque')) return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  return !/(?:no-store|private)/i.test(cacheControl);
};

const putBounded = async (cacheName, request, response, maximumEntries) => {
  if (!mayCache(response)) return;
  const cache = await caches.open(cacheName);
  // Refresh insertion order so trimming removes the least recently updated entry.
  await cache.delete(request);
  await cache.put(request, response);
  await trimCache(cacheName, maximumEntries);
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })));
    if (self.registration.active) {
      await notifyClients({ type: 'AURORA_SW_UPDATE_AVAILABLE', version: VERSION });
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const currentCaches = new Set([SHELL_CACHE, STATIC_CACHE, ARTWORK_CACHE]);
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(CACHE_PREFIX) && !currentCaches.has(name))
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
    await notifyClients({ type: 'AURORA_SW_READY', version: VERSION });
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'AURORA_SW_SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === 'AURORA_SW_GET_VERSION') {
    event.source?.postMessage({ type: 'AURORA_SW_VERSION', version: VERSION });
  }
});

const isNetworkOnly = (request, url) => {
  const path = url.pathname.toLowerCase();
  return request.headers.has('range')
    || request.destination === 'audio'
    || request.destination === 'video'
    || path === '/api'
    || path.startsWith('/api/')
    || path === '/stream'
    || path.startsWith('/stream/')
    || path === '/streams'
    || path.startsWith('/streams/');
};

const navigationResponse = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(ROOT_URL, response.clone());
    }
    return response;
  } catch (error) {
    const cachedShell = await caches.match(ROOT_URL, { ignoreSearch: true });
    if (cachedShell) return cachedShell;
    throw error;
  }
};

const staleWhileRevalidate = async (event, cacheName, maximumEntries) => {
  const request = event.request;
  const cached = await caches.match(request);
  const refresh = fetch(request).then(async (response) => {
    await putBounded(cacheName, request, response.clone(), maximumEntries);
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }

  return refresh;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // API responses, range requests, and media streams must never enter a
  // service-worker cache or the browser's HTTP cache.
  if (isNetworkOnly(request, url)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (url.origin === self.location.origin && (request.mode === 'navigate' || request.destination === 'document')) {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(event, ARTWORK_CACHE, ARTWORK_CACHE_LIMIT));
    return;
  }

  if (url.origin !== self.location.origin) return;

  const isStaticAsset = ['script', 'style', 'font', 'worker'].includes(request.destination)
    || /\.(?:css|js|mjs|woff2?|ttf|otf)$/i.test(url.pathname);
  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(event, STATIC_CACHE, STATIC_CACHE_LIMIT));
  }
});
