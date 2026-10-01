import { Readable } from 'node:stream';
import { Router, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { HttpError, asyncHandler, sendError, withTimeout } from '../errors.js';
import {
  asText,
  normalizeExploreCategories,
  normalizeHeader,
  normalizeItem,
  normalizeSections,
  normalizeSuggestions,
} from '../normalizers.js';
import { isAllowedMediaUrl, type AudioExtractor, type AudioQuality } from '../services/ytdlp.js';
import { fetchLyrics } from '../services/lyrics.js';
import { generateMusicIdea } from '../services/ai.js';
import { rerankMusicCandidates } from '../services/typesafe.js';
import { readPublicPage, searchReference } from '../services/webTools.js';
import type { MusicProvider } from '../services/youtube.js';
import { z } from 'zod';
import {
  albumParamsSchema,
  artistParamsSchema,
  parseWith,
  playlistParamsSchema,
  rangeHeaderSchema,
  searchQuerySchema,
  suggestionsQuerySchema,
  trackParamsSchema,
} from '../validation.js';

type UnknownRecord = Record<string, unknown>;

const PROVIDER_TIMEOUT_MS = 25_000;
const STREAM_CONNECT_TIMEOUT_MS = 20_000;
const HOME_CACHE_MS = 5 * 60_000;

export interface ApiDependencies {
  music: MusicProvider;
  audio: AudioExtractor;
}

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : {};
}

function values(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function providerCall<T>(label: string, message: string, operation: Promise<T>): Promise<T> {
  try {
    return await withTimeout(operation, PROVIDER_TIMEOUT_MS, `${label} timed out.`);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`${label} failed:`, detail);
    throw new HttpError(502, 'UPSTREAM_ERROR', message);
  }
}

function limiter(limit: number, windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      sendError(req, res, new HttpError(429, 'RATE_LIMITED', 'Too many requests. Please wait and try again.'));
    },
  });
}

// Small TTL cache with in-flight coalescing for catalog reads. The YouTube
// Music catalog is public and identical for every listener, so sharing a fresh
// answer across users is safe and removes most duplicate upstream calls
// (back-to-back searches, page refresh herds, explore reloads).
function createCatalogCache(ttlMs: number, maxEntries = 300) {
  const entries = new Map<string, { savedAt: number; payload: unknown }>();
  const inFlight = new Map<string, Promise<unknown>>();
  return async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.savedAt < ttlMs) return hit.payload as T;
    const running = inFlight.get(key);
    if (running) return running as Promise<T>;
    const task = load().then((payload) => {
      entries.set(key, { savedAt: Date.now(), payload });
      if (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      return payload;
    }).finally(() => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    });
    inFlight.set(key, task);
    return task;
  };
}

function missingYtDlp(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function clientDisconnected(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function fetchMedia(url: string, headers: Headers, signal: AbortSignal): Promise<Response> {
  let currentUrl = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetch(currentUrl, { headers, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => undefined);
    if (!location) return response;
    const nextUrl = new URL(location, currentUrl).href;
    if (!isAllowedMediaUrl(nextUrl)) {
      throw new HttpError(502, 'UPSTREAM_ERROR', 'The audio provider returned an unsafe redirect.');
    }
    currentUrl = nextUrl;
  }
  throw new HttpError(502, 'UPSTREAM_ERROR', 'The audio provider returned too many redirects.');
}

export function createApiRouter({ music, audio }: ApiDependencies): Router {
  const router = Router();

  router.get('/health', asyncHandler(async (_req, res) => {
    const ytDlp = await audio.readiness();
    res.set('Cache-Control', 'no-store').json({
      ready: true,
      service: 'Aurora Music Web',
      apiVersion: 'v1',
      degraded: !ytDlp.ready,
      ytDlp,
      checks: { api: { ready: true }, ytDlp },
      timestamp: new Date().toISOString(),
    });
  }));

  router.get('/capabilities', asyncHandler(async (_req, res) => {
    const ytDlp = await audio.readiness();
    res.set('Cache-Control', 'private, max-age=60').json({
      apiVersion: 'v1',
      capabilities: {
        home: true,
        search: ['song', 'video', 'artist', 'album', 'playlist'],
        suggestions: true,
        artist: true,
        album: true,
        playlist: true,
        related: true,
        lyrics: true,
        explore: true,
        discovery: true,
        stream: { supported: true, ready: ytDlp.ready },
      },
      dependencies: { ytDlp },
    });
  }));

  router.use(limiter(300, 15 * 60_000));

  async function resolveAiQueries(queries: string[], limitPerQuery = 1): Promise<UnknownRecord[]> {
    const tracks: UnknownRecord[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < queries.length; index += 2) {
      const results = await Promise.allSettled(queries.slice(index, index + 2).map((query) =>
        withTimeout(music.search(query, 'song'), 12_000, 'Music search timed out.')));
      for (const outcome of results) {
        if (outcome.status !== 'fulfilled') continue;
        const result = record(outcome.value);
        const matches = values(record(result.songs).contents).map((item) => record(normalizeItem(item, 'song')))
          .filter((item) => typeof item.id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(item.id));
        for (const match of matches.slice(0, limitPerQuery)) {
          if (!seen.has(match.id as string)) { seen.add(match.id as string); tracks.push(match); }
        }
      }
    }
    return tracks;
  }

  router.post('/ai/resolve', limiter(20, 15 * 60_000), asyncHandler(async (req, res) => {
    const input = parseWith(z.object({ queries: z.array(z.string().trim().min(2).max(100)).min(1).max(5) }), req.body);
    const tracks = await resolveAiQueries(input.queries, input.queries.length === 1 ? 6 : 1);
    if (!tracks.length) throw new HttpError(502, 'UPSTREAM_ERROR', 'No songs found. Try another description.');
    res.set('Cache-Control', 'no-store').json({ tracks });
  }));

  router.post('/ai/web', limiter(15, 15 * 60_000), asyncHandler(async (req, res) => {
    const input = parseWith(z.discriminatedUnion('action', [
      z.object({ action: z.literal('search'), query: z.string().trim().min(2).max(140) }),
      z.object({ action: z.literal('read'), url: z.string().trim().min(12).max(1000) }),
    ]), req.body);
    const result = input.action === 'search' ? { results: await searchReference(input.query) } : await readPublicPage(input.url);
    res.set('Cache-Control', 'no-store').json(result);
  }));

  router.post('/ai/music', limiter(8, 15 * 60_000), asyncHandler(async (req, res) => {
    const input = parseWith(z.object({
      prompt: z.string().trim().min(3).max(300),
      mode: z.enum(['create', 'extend', 'discover']).default('create'),
      seeds: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
    }), req.body);
    const idea = await generateMusicIdea(input.prompt, input.seeds, input.mode);
    const candidates = await resolveAiQueries(idea.queries);
    const { tracks, ranked } = await rerankMusicCandidates(input.prompt, candidates.map((track) => ({
      id: String(track.id), title: String(track.title), artist: String(track.artist ?? ''),
      ...(typeof track.album === 'string' ? { album: track.album } : {}),
    })));
    if (!tracks.length) throw new HttpError(502, 'UPSTREAM_ERROR', 'No matching songs found. Try another mood or artist.');
    res.set('Cache-Control', 'no-store').json({ ...idea, tracks, ranking: ranked ? 'typesafe' : 'catalog' });
  }));

  // Every call spends the server's YouTube Data API quota, so it gets a budget
  // far tighter than the global limiter.
  router.get('/account/youtube-music', limiter(20, 15 * 60_000), asyncHandler(async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const apiKey = process.env.GOOGLE_YOUTUBE_API_KEY;
    if (!clientId || !apiKey) throw new HttpError(503, 'SERVICE_UNAVAILABLE', 'Google sign-in needs a web OAuth client ID and YouTube Data API key in the server environment.');
    const token = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (!token || token.length > 4096) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to your Google account again to use personalized suggestions.');

    const tokenInfoUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
    tokenInfoUrl.searchParams.set('access_token', token);
    const tokenResponse = await fetch(tokenInfoUrl, { signal: AbortSignal.timeout(8_000) });
    const tokenInfo = record(await tokenResponse.json().catch(() => ({})));
    const scopes = String(tokenInfo.scope ?? '').split(/\s+/);
    if (!tokenResponse.ok || tokenInfo.aud !== clientId || !scopes.includes('https://www.googleapis.com/auth/youtube.readonly')) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Google did not grant YouTube read access. Reconnect and allow the requested permission.');
    }

    const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
    channelUrl.search = new URLSearchParams({ part: 'snippet', mine: 'true', key: apiKey }).toString();
    const likedUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
    likedUrl.search = new URLSearchParams({ part: 'snippet,contentDetails', myRating: 'like', maxResults: '30', key: apiKey }).toString();
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const [channelResponse, likedResponse] = await Promise.all([
      fetch(channelUrl, { headers, signal: AbortSignal.timeout(12_000) }),
      fetch(likedUrl, { headers, signal: AbortSignal.timeout(12_000) }),
    ]);
    const [channelBody, likedBody] = await Promise.all([channelResponse.json().catch(() => ({})), likedResponse.json().catch(() => ({}))]);
    if (!channelResponse.ok || !likedResponse.ok) throw new HttpError(502, 'UPSTREAM_ERROR', 'YouTube could not return this account’s likes. Check YouTube access and try again.');
    const channel = record(values(record(channelBody).items)[0]);
    const snippet = record(channel.snippet);
    const thumbnails = record(snippet.thumbnails);
    const tracks = values(record(likedBody).items).map((entry) => {
      const video = record(entry);
      const videoSnippet = record(video.snippet);
      const images = record(videoSnippet.thumbnails);
      const artwork = record(images.maxres).url ?? record(images.high).url ?? record(images.medium).url ?? record(images.default).url;
      return {
        id: String(video.id ?? ''), kind: 'video', source: 'remote', title: String(videoSnippet.title ?? ''),
        artist: String(videoSnippet.channelTitle ?? 'YouTube Music'), artwork: typeof artwork === 'string' ? artwork : '',
        duration: String(record(video.contentDetails).duration ?? ''),
      };
    }).filter((item) => item.id && item.title);
    res.set('Cache-Control', 'no-store').json({
      name: String(snippet.title ?? ''),
      avatar: String(record(thumbnails.medium).url ?? record(thumbnails.default).url ?? ''),
      tracks,
    });
  }));

  const cachedCatalog = createCatalogCache(90_000);
  const cachedEntity = createCatalogCache(5 * 60_000);
  // Coalesced so concurrent requests during a cache miss share one upstream call.
  const cachedHome = createCatalogCache(HOME_CACHE_MS, 4);

  router.get('/home', asyncHandler(async (_req, res) => {
    const data = await cachedHome('home', async () => {
      const feed = record(await providerCall(
        'Home feed',
        'Aurora could not load music right now. Try again in a moment.',
        music.getHome(),
      ));
      return {
        sections: normalizeSections(feed.sections, 'Made for you', 'playlist'),
        updatedAt: new Date().toISOString(),
      };
    });
    res.set('Cache-Control', 'public, max-age=300').json(data);
  }));

  router.get('/search', limiter(120, 15 * 60_000), asyncHandler(async (req, res) => {
    const { q: query, type } = parseWith(searchQuerySchema, req.query);
    const result = record(await cachedCatalog(`search:${type}:${query.toLowerCase()}`, () => providerCall(
      'Search',
      'Music search is unavailable right now. Try again in a moment.',
      music.search(query, type),
    )));
    const shelfName = type === 'song' ? 'songs' : `${type}s`;
    const shelf = record(result[shelfName]);
    const items = values(shelf.contents)
      .map((item) => normalizeItem(item, type))
      .filter((item) => item.id || item.browseId);

    res.set('Cache-Control', 'private, max-age=45').json({
      items,
      ...((type === 'song' || type === 'video') ? { tracks: items } : {}),
      query,
      type,
    });
  }));

  router.get('/suggestions', limiter(180, 15 * 60_000), asyncHandler(async (req, res) => {
    const { q: query, limit } = parseWith(suggestionsQuerySchema, req.query);
    const result = await cachedCatalog(`suggest:${query.toLowerCase()}`, () => providerCall(
      'Search suggestions',
      'Search suggestions are unavailable right now.',
      music.getSuggestions(query),
    ));
    const suggestions = normalizeSuggestions(result).slice(0, limit);
    res.set('Cache-Control', 'private, max-age=60').json({ suggestions, query });
  }));

  router.get(['/explore', '/discovery', '/discover'], asyncHandler(async (_req, res) => {
    const explore = record(await cachedEntity('explore', () => providerCall(
      'Explore',
      'Explore is unavailable right now. Try again in a moment.',
      music.getExplore(),
    )));
    const sections = normalizeSections(explore.sections, 'Explore', 'playlist');
    const categories = normalizeExploreCategories(explore.top_buttons);
    res.set('Cache-Control', 'public, max-age=180').json({
      sections,
      categories,
      updatedAt: new Date().toISOString(),
    });
  }));

  router.get('/artist/:id', asyncHandler(async (req, res) => {
    const { id } = parseWith(artistParamsSchema, req.params);
    const artist = record(await cachedEntity(`artist:${id}`, () => providerCall(
      'Artist lookup',
      'This artist page could not be loaded.',
      music.getArtist(id),
    )));
    res.set('Cache-Control', 'private, max-age=90').json({
      artist: normalizeHeader(artist.header),
      sections: normalizeSections(artist.sections, 'More music'),
    });
  }));

  router.get('/album/:id', asyncHandler(async (req, res) => {
    const { id } = parseWith(albumParamsSchema, req.params);
    const album = record(await cachedEntity(`album:${id}`, () => providerCall(
      'Album lookup',
      'This album could not be loaded.',
      music.getAlbum(id),
    )));
    const items = values(album.contents)
      .map((item) => normalizeItem(item, 'song'))
      .filter((item) => item.id);
    res.set('Cache-Control', 'private, max-age=90').json({
      album: normalizeHeader(album.header),
      sections: [{ title: 'Track list', items }],
    });
  }));

  router.get('/playlist/:id', asyncHandler(async (req, res) => {
    const { id } = parseWith(playlistParamsSchema, req.params);
    const playlist = record(await cachedEntity(`playlist:${id}`, () => providerCall(
      'Playlist lookup',
      'This playlist could not be loaded.',
      music.getPlaylist(id),
    )));
    const items = values(playlist.contents)
      .map((item) => normalizeItem(item, 'song'))
      .filter((item) => item.id);
    res.set('Cache-Control', 'private, max-age=90').json({
      playlist: normalizeHeader(playlist.header),
      items,
    });
  }));

  router.get('/related/:id', asyncHandler(async (req, res) => {
    const { id } = parseWith(trackParamsSchema, req.params);
    const related = record(await cachedEntity(`related:${id}`, () => providerCall(
      'Related music lookup',
      'Related music could not be loaded.',
      music.getRelated(id),
    )));
    const sections = normalizeSections(related.contents, 'Related music');
    res.set('Cache-Control', 'private, max-age=90').json({ sections });
  }));

  router.get('/lyrics/:id', asyncHandler(async (req, res) => {
    const { id } = parseWith(trackParamsSchema, req.params);
    const queryText = (key: string, maximum: number): string => {
      const value = typeof req.query[key] === 'string' ? (req.query[key] as string).trim() : '';
      return value.slice(0, maximum);
    };
    const durationValue = Number(req.query.duration);
    const result = await fetchLyrics(music, {
      id,
      title: queryText('title', 200),
      artist: queryText('artist', 200),
      album: queryText('album', 200),
      duration: Number.isFinite(durationValue) && durationValue > 0 ? Math.min(86_400, durationValue) : undefined,
    });
    res.set('Cache-Control', 'private, max-age=900').json(result ?? { lines: [], provider: '', synced: false });
  }));

  const requestedQuality = (value: unknown): AudioQuality =>
    value === 'high' || value === 'data-saver' ? value : 'auto';

  // Resolve the upcoming song while the current one plays. This only warms
  // the signed URL; it does not download or cache the audio. Results share the
  // extractor's cache + in-flight dedupe, so repeats are free.
  router.get('/stream-warm/:id', limiter(120, 15 * 60_000), asyncHandler(async (req, res) => {
    const { id } = parseWith(trackParamsSchema, req.params);
    const quality = requestedQuality(req.query.quality);
    if (audio.warmAudioFormat) await audio.warmAudioFormat(id, quality);
    else await audio.getAudioFormat(id, false, quality);
    res.set('Cache-Control', 'no-store').status(204).end();
  }));

  // HTML5 audio issues several range GETs per song (plus seeks and reconnects);
  // 90/15m was reachable by a single active listener. 400 keeps abuse bounded
  // without self-DoS during normal playback.
  router.get('/stream/:id', limiter(400, 15 * 60_000), asyncHandler(async (req, res) => {
    const { id } = parseWith(trackParamsSchema, req.params);
    const quality = requestedQuality(req.query.quality);
    const range = req.headers.range;
    if (range) {
      const result = rangeHeaderSchema.safeParse(range);
      if (!result.success) throw new HttpError(416, 'BAD_REQUEST', 'Invalid Range header.');
    }

    const disconnectController = new AbortController();
    const abort = (): void => disconnectController.abort();
    req.once('aborted', abort);
    res.once('close', abort);

    try {
      let upstream: Response | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const format = req.query.prefetch === '1'
          ? await audio.getAudioFormat(id, attempt > 0, quality, 'background')
          : await audio.getAudioFormat(id, attempt > 0, quality);
        const headers = new Headers(format.httpHeaders);
        if (range) headers.set('Range', range);

        const connectionController = new AbortController();
        const connectionTimer = setTimeout(() => connectionController.abort(), STREAM_CONNECT_TIMEOUT_MS);
        connectionTimer.unref?.();
        try {
          upstream = await fetchMedia(
            format.url,
            headers,
            AbortSignal.any([disconnectController.signal, connectionController.signal]),
          );
        } catch (error) {
          if (disconnectController.signal.aborted) throw error;
          if (attempt === 0) {
            audio.invalidate(id);
            continue;
          }
          if (connectionController.signal.aborted) {
            throw new HttpError(504, 'REQUEST_TIMEOUT', 'The song server took too long to respond. Please retry.');
          }
          throw error;
        } finally {
          clearTimeout(connectionTimer);
        }

        if (upstream.ok && upstream.body) break;
        if (range && upstream.status === 416) {
          res.status(416);
          const contentRange = upstream.headers.get('content-range');
          if (contentRange) res.setHeader('Content-Range', contentRange);
          await upstream.body?.cancel().catch(() => undefined);
          res.end();
          return;
        }
        audio.invalidate(id);
        await upstream.body?.cancel().catch(() => undefined);
        if (attempt === 1) {
          throw new HttpError(
            502,
            'UPSTREAM_ERROR',
            `yt-dlp could not fetch this track (upstream ${upstream.status}). Try another song.`,
          );
        }
      }

      if (!upstream?.ok || !upstream.body) {
        throw new HttpError(502, 'UPSTREAM_ERROR', 'yt-dlp did not return an audio stream.');
      }

      res.status(upstream.status);
      for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = upstream.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      Readable.fromWeb(upstream.body as never)
        .on('error', (error) => {
          if (!clientDisconnected(error)) console.error('Audio stream failed:', error.message);
          if (!res.destroyed) res.destroy(error);
        })
        .pipe(res);
    } catch (error) {
      if (disconnectController.signal.aborted) return;
      if (error instanceof HttpError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      console.error('Stream request failed:', detail);
      throw new HttpError(
        missingYtDlp(error) ? 503 : 502,
        missingYtDlp(error) ? 'SERVICE_UNAVAILABLE' : 'UPSTREAM_ERROR',
        missingYtDlp(error)
          ? 'yt-dlp is required for playback. Install it with: py -3 -m pip install --user -r web/requirements.txt'
          : 'Could not start playback. yt-dlp could not extract this song.',
      );
    } finally {
      req.off('aborted', abort);
    }
  }));

  return router;
}
