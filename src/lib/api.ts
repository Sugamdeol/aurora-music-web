import type { EntityDetail, ExploreCategory, LyricLine, MediaEntity, MediaKind, MediaSection, MediaTrack } from '../domain/media';
import { parseDuration } from '../domain/media';

export class ApiError extends Error {
  constructor(message: string, readonly status = 0, readonly cause?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value !== null && typeof value === 'object' ? value as UnknownRecord : {};
const asString = (value: unknown): string => typeof value === 'string' ? value : value == null ? '' : String(value);
const errorMessage = (value: unknown): string => typeof value === 'string' ? value : asString(asRecord(value).message ?? asRecord(value).detail);
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function upgradedArtwork(value: unknown): string {
  const raw = asString(value);
  if (!raw) return '';
  try {
    const url = new URL(raw, window.location.origin);
    if (url.hostname.endsWith('googleusercontent.com')) {
      url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+)[^/]*$/, '=w1200-h1200-l90-rj');
    } else if (url.hostname.endsWith('ytimg.com')) {
      url.pathname = url.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(jpg|webp)$/i, '/maxresdefault.$1');
    }
    return url.href;
  } catch {
    return raw;
  }
}

function normalizeKind(value: unknown, fallback: MediaKind): MediaKind {
  const kind = asString(value).toLowerCase();
  return ['song', 'video', 'album', 'artist', 'playlist', 'local'].includes(kind) ? kind as MediaKind : fallback;
}

export function normalizeMedia(value: unknown, fallback: MediaKind = 'song'): MediaEntity | MediaTrack | null {
  const source = asRecord(value);
  const kind = normalizeKind(source.kind ?? source.type ?? source.item_type, fallback);
  const id = asString(source.id) || asString(source.videoId) || asString(source.video_id) || asString(source.browseId) || asString(source.browse_id);
  const browseId = asString(source.browseId) || asString(source.browse_id);
  const title = asString(source.title ?? source.name).trim();
  if (!id || !title) return null;
  const artist = asString(source.artist ?? source.author ?? source.subtitle).trim() || 'Unknown artist';
  const artwork = upgradedArtwork(source.artwork ?? source.thumbnail ?? source.image);

  if (kind === 'song' || kind === 'video' || kind === 'local') {
    const durationLabel = asString(source.durationLabel ?? source.duration ?? source.duration_text);
    const artists = asArray(source.artists).map((artistValue) => {
      const item = asRecord(artistValue);
      return { id: asString(item.id), name: asString(item.name) };
    }).filter((item) => item.name);
    return {
      id,
      kind,
      title,
      artist,
      artists,
      artistId: asString(source.artistId ?? source.artist_id) || artists[0]?.id,
      album: asString(source.album),
      albumId: asString(source.albumId ?? source.album_id),
      artwork,
      durationSeconds: parseDuration(source.durationSeconds ?? source.duration_seconds ?? source.duration),
      durationLabel,
      source: kind === 'local' || source.local === true ? 'local' : 'remote',
      streamUrl: asString(source.streamUrl ?? source.stream_url) || undefined,
      fileId: asString(source.fileId ?? source.file_id) || undefined,
      explicit: Boolean(source.explicit),
    };
  }

  return {
    id,
    browseId: browseId || id,
    kind,
    title,
    subtitle: asString(source.subtitle),
    artist,
    artistId: asString(source.artistId ?? source.artist_id),
    artwork,
    description: asString(source.description),
    year: asString(source.year),
    count: typeof source.count === 'number' || typeof source.count === 'string' ? source.count : undefined,
  };
}

function normalizeSection(value: unknown, index: number): MediaSection | null {
  const section = asRecord(value);
  const title = asString(section.title ?? asRecord(section.header).title) || 'Made for you';
  const items = asArray(section.items ?? section.contents)
    .map((item) => normalizeMedia(item, 'playlist'))
    .filter((item): item is MediaEntity | MediaTrack => item !== null);
  return items.length ? { id: `${title.toLowerCase().replace(/\W+/g, '-')}-${index}`, title, items } : null;
}

async function requestJson(paths: string[], init: RequestInit = {}): Promise<unknown> {
  let lastError: ApiError | undefined;
  for (const path of paths) {
    try {
      const response = await fetch(path, { ...init, headers: { Accept: 'application/json', ...init.headers } });
      const text = await response.text();
      let body: unknown = {};
      let parsed = !text;
      if (text) {
        try { body = JSON.parse(text); parsed = true; } catch { body = { error: text }; }
      }
      if (response.ok && parsed) return body;
      if (response.ok && !parsed) {
        lastError = new ApiError('The endpoint returned an unexpected response.', 404);
        continue;
      }
      const message = errorMessage(asRecord(body).error) || errorMessage(body) || `Request failed (${response.status})`;
      lastError = new ApiError(message, response.status);
      if (response.status !== 404 && response.status !== 405) throw lastError;
    } catch (error) {
      if (error instanceof ApiError && error.status !== 404 && error.status !== 405) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      lastError = error instanceof ApiError ? error : new ApiError('Aurora could not reach the music service.', 0, error);
    }
  }
  throw lastError ?? new ApiError('Aurora could not reach the music service.');
}

export const api = {
  async resolveAiSongs(queries: string[]): Promise<MediaTrack[]> {
    const body = asRecord(await requestJson(['/api/v1/ai/resolve'], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries }) }));
    return asArray(body.tracks).map((track) => normalizeMedia(track, 'song')).filter((track): track is MediaTrack => Boolean(track && 'source' in track && track.source === 'remote'));
  },
  async webSearch(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
    const body = asRecord(await requestJson(['/api/v1/ai/web'], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search', query }) }));
    return asArray(body.results).map((value) => asRecord(value)).filter((value) => typeof value.url === 'string').map((value) => ({ title: asString(value.title), snippet: asString(value.snippet), url: asString(value.url) }));
  },
  async webRead(url: string): Promise<{ url: string; text: string }> {
    const body = asRecord(await requestJson(['/api/v1/ai/web'], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', url }) }));
    return { url: asString(body.url), text: asString(body.text) };
  },
  async aiMusic(prompt: string, mode: 'create' | 'extend' | 'discover', seeds: string[] = []): Promise<{ title: string; description: string; tracks: MediaTrack[]; ranking: 'typesafe' | 'catalog' }> {
    const body = asRecord(await requestJson(['/api/v1/ai/music'], { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, mode, seeds }) }));
    return {
      title: asString(body.title).slice(0, 64) || 'Your AI mix',
      description: asString(body.description).slice(0, 200),
      tracks: asArray(body.tracks).map((track) => normalizeMedia(track, 'song')).filter((track): track is MediaTrack => Boolean(track && 'source' in track && track.source === 'remote')),
      ranking: asString(body.ranking) === 'typesafe' ? 'typesafe' : 'catalog',
    };
  },
  async warmStream(track: MediaTrack, quality: 'auto' | 'high' | 'data-saver' = 'auto'): Promise<void> {
    if (track.source !== 'remote' || track.streamUrl) return;
    const suffix = quality === 'auto' ? '' : `?quality=${encodeURIComponent(quality)}`;
    const response = await fetch(`/api/v1/stream-warm/${encodeURIComponent(track.id)}${suffix}`, { cache: 'no-store' });
    if (!response.ok) throw new ApiError('Could not prepare this song.', response.status);
  },
  async health(signal?: AbortSignal): Promise<boolean> {
    try {
      const body = asRecord(await requestJson(['/api/v1/health', '/api/health'], { signal }));
      return body.ready !== false;
    } catch { return false; }
  },

  async youtubeMusicAccount(token: string): Promise<{ name: string; avatar: string; tracks: MediaTrack[] }> {
    const body = asRecord(await requestJson(['/api/v1/account/youtube-music'], { headers: { authorization: `Bearer ${token}` } }));
    const tracks = asArray(body.tracks).map((item) => normalizeMedia(item, 'video')).filter((item): item is MediaTrack => Boolean(item && 'source' in item));
    return { name: asString(body.name), avatar: asString(body.avatar), tracks };
  },

  async explore(signal?: AbortSignal): Promise<{ sections: MediaSection[]; categories: ExploreCategory[] }> {
    const body = asRecord(await requestJson(['/api/v1/explore', '/api/explore'], { signal }));
    const sections = asArray(body.sections).map(normalizeSection).filter((section): section is MediaSection => section !== null);
    const categories = asArray(body.categories)
      .map((value) => { const item = asRecord(value); return { title: asString(item.title), browseId: asString(item.browseId) }; })
      .filter((category) => category.title && category.browseId);
    return { sections, categories };
  },

  async home(signal?: AbortSignal): Promise<MediaSection[]> {
    const body = asRecord(await requestJson(['/api/v1/home', '/api/home'], { signal }));
    return asArray(body.sections).map(normalizeSection).filter((section): section is MediaSection => section !== null);
  },

  async search(query: string, kind: Exclude<MediaKind, 'local'>, signal?: AbortSignal): Promise<Array<MediaEntity | MediaTrack>> {
    const params = new URLSearchParams({ q: query.trim(), type: kind });
    const body = asRecord(await requestJson([`/api/v1/search?${params}`, `/api/search?${params}`], { signal }));
    const values = asArray(body.items ?? body.tracks ?? body.results);
    return values.map((item) => normalizeMedia(item, kind)).filter((item): item is MediaEntity | MediaTrack => item !== null);
  },

  async suggestions(query: string, signal?: AbortSignal): Promise<string[]> {
    const params = new URLSearchParams({ q: query, limit: '7' });
    const body = asRecord(await requestJson([`/api/v1/suggestions?${params}`, `/api/suggestions?${params}`], { signal }));
    return asArray(body.suggestions).map(asString).map((value) => value.trim()).filter(Boolean).slice(0, 7);
  },

  async entity(kind: EntityDetail['kind'], id: string, signal?: AbortSignal): Promise<EntityDetail> {
    const safeId = encodeURIComponent(id);
    const body = asRecord(await requestJson([`/api/v1/${kind}/${safeId}`, `/api/${kind}/${safeId}`], { signal }));
    const header = asRecord(body[kind] ?? body.header ?? body.entity);
    const sections = asArray(body.sections).map(normalizeSection).filter((section): section is MediaSection => section !== null);
    if (kind === 'playlist' && Array.isArray(body.items)) {
      const playlistSection = normalizeSection({ title: 'Track list', items: body.items }, sections.length);
      if (playlistSection) sections.push(playlistSection);
    }
    const tracks = sections.flatMap((section) => section.items).filter((item): item is MediaTrack => 'source' in item);
    return {
      kind,
      id,
      title: asString(header.title ?? header.name) || 'Aurora Music',
      subtitle: asString(header.subtitle),
      description: asString(header.description),
      artist: asString(header.artist),
      artistId: asString(header.artistId ?? header.artist_id),
      year: asString(header.year),
      count: typeof header.count === 'number' || typeof header.count === 'string' ? header.count : undefined,
      artwork: upgradedArtwork(header.artwork ?? header.thumbnail),
      sections,
      tracks,
    };
  },

  async related(id: string, signal?: AbortSignal): Promise<MediaTrack[]> {
    const safeId = encodeURIComponent(id);
    const body = asRecord(await requestJson([`/api/v1/related/${safeId}`, `/api/related/${safeId}`], { signal }));
    return asArray(body.sections).flatMap((section, index) => normalizeSection(section, index)?.items ?? [])
      .filter((item): item is MediaTrack => 'source' in item);
  },

  async lyrics(track: MediaTrack, signal?: AbortSignal): Promise<{ lines: LyricLine[]; provider: string; synced: boolean }> {
    const safeId = encodeURIComponent(track.id);
    const params = new URLSearchParams({ title: track.title, artist: track.artist });
    if (track.album) params.set('album', track.album);
    if (track.durationSeconds) params.set('duration', String(Math.round(track.durationSeconds)));
    const body = asRecord(await requestJson([`/api/v1/lyrics/${safeId}?${params}`, `/api/lyrics/${safeId}?${params}`], { signal }));
    const synced = asArray(body.lines ?? body.syncedLyrics);
    if (synced.length) {
      const lines = synced.map((line) => {
        const item = asRecord(line);
        const rawTime = Number(item.time ?? item.startTime ?? item.start_time);
        return { time: Number.isFinite(rawTime) ? (rawTime > 1_000 ? rawTime / 1_000 : rawTime) : undefined, text: asString(item.text ?? item.line), romanized: asString(item.romanized) || undefined };
      }).filter((line) => line.text.trim());
      return { lines, provider: asString(body.provider), synced: Boolean(body.synced ?? lines.some((line) => line.time !== undefined)) };
    }
    const lines = asString(body.lyrics).split(/\r?\n/).map((text) => ({ text: text.trim() })).filter((line) => line.text);
    return { lines, provider: asString(body.provider), synced: false };
  },
};

export function streamCandidates(track: MediaTrack, quality: 'auto' | 'high' | 'data-saver' = 'auto'): string[] {
  const id = encodeURIComponent(track.id);
  const suffix = quality === 'auto' ? '' : `?quality=${encodeURIComponent(quality)}`;
  const resolver = `/api/v1/stream/${id}${suffix}`;
  // streamUrl is a signed URL that expires within hours. A restored queue or an
  // expired mid-session URL must still be able to fall back to a fresh
  // server-side resolution instead of dead-ending with an unrecoverable error.
  const candidates = track.streamUrl && track.streamUrl !== resolver ? [track.streamUrl, resolver] : [resolver];
  return track.source === 'local' ? [] : candidates;
}
