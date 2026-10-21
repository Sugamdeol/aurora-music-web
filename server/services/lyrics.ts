import type { MusicProvider } from './youtube.js';
import { romanizeLyrics, type LyricLanguage } from './romanization.js';
import { TaskQueue } from './taskQueue.js';

export interface LyricsTrackInfo {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  source?: string;
  language?: LyricLanguage;
}

export interface TimedLyric {
  time?: number;
  text: string;
  romanized?: string;
}

export interface LyricsResult {
  lines: TimedLyric[];
  provider: string;
  synced: boolean;
  approximate?: boolean;
}

interface Candidate extends LyricsResult { priority: number }

const CACHE_MS = 15 * 60_000;
const lyricsCache = new Map<string, { result: LyricsResult; until: number }>();
const lyricsInFlight = new Map<string, Promise<LyricsResult | undefined>>();
// Lyrics lookups run one at a time so a burst of requests does not hammer
// the community sources. The concurrency is not one, because one slow
// source must not block the others for the whole request.
const lyricsQueue = new TaskQueue(3);

const YOU_LY_PLUS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
];

const BROWSER_HEADERS = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'en-US,en;q=0.9',
  'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

function timestampSeconds(value: string): number | undefined {
  const clean = value.trim().replace(',', '.');
  const parts = clean.split(':');
  const seconds = parts.length === 3
    ? Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
    : parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(clean);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Reads a time that may be in seconds, milliseconds, or a timestamp
 * string. Providers disagree on the unit, so it is detected from the
 * magnitude instead of being assumed.
 */
function timeValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? (raw > 1000 ? raw / 1000 : raw) : undefined;
  if (typeof raw === 'string') {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return numeric > 1000 ? numeric / 1000 : numeric;
    return timestampSeconds(raw);
  }
  return undefined;
}

function parseTextLyrics(raw: string): TimedLyric[] {
  const value = raw.trim();
  if (!value) return [];
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== value) return parseValue(parsed);
    } catch { /* Plain lyric text can begin with punctuation that resembles JSON. */ }
  }
  if (value.startsWith('<') && /<tt\b|<\?xml/i.test(value)) {
    const rows: TimedLyric[] = [];
    for (const match of value.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      const begin = match[1]?.match(/\bbegin=["']([^"']+)["']/i)?.[1];
      const time = begin ? timestampSeconds(begin) : undefined;
      const text = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')).trim();
      if (text) rows.push({ ...(time === undefined ? {} : { time }), text });
    }
    if (rows.length) return rows;
  }

  const rows: TimedLyric[] = [];
  for (const row of value.split(/\r?\n/)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
    const text = decodeEntities(row.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim());
    if (!text || /^\s*$/u.test(text)) continue;
    if (stamps.length) {
      for (const stamp of stamps) {
        const time = timestampSeconds((stamp[1] ?? '').replace('.', '.'));
        if (time !== undefined) rows.push({ time, text });
      }
    } else if (!/^\s*(ar|ti|al|by|re|ve|offset|length|kana|la|au|length)\s*:/i.test(text)) {
      rows.push({ text });
    }
  }
  return rows;
}

function parseValue(value: unknown): TimedLyric[] {
  if (typeof value === 'string') return parseTextLyrics(value);
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === 'string') return parseTextLyrics(entry);
    const item = record(entry);
    const rawText = item.text ?? item.line ?? item.lyric ?? item.words;
    const text = (Array.isArray(rawText) ? rawText.map((word) => typeof word === 'string' ? word : String(record(word).text ?? '')).join(' ') : String(rawText ?? '')).trim();
    if (!text) return [];
    const rawTime = item.time ?? item.startTime ?? item.start_time ?? item.timestamp ?? item.start;
    const numeric = typeof rawTime === 'number' ? rawTime : Number(rawTime);
    const seconds = Number.isFinite(numeric) ? (numeric > 1000 ? numeric / 1000 : numeric) : typeof rawTime === 'string' ? timestampSeconds(rawTime) : undefined;
    return [{ ...(seconds === undefined ? {} : { time: seconds }), text }];
  });
}

function firstLyrics(value: unknown): TimedLyric[] {
  if (typeof value === 'string' || Array.isArray(value)) return parseValue(value);
  const item = record(value);
  for (const key of ['richSyncLyrics', 'syncedLyrics', 'ttmlContent', 'ttml', 'lyrics', 'plainLyrics', 'plainLyric', 'plain', 'description']) {
    const rows = parseValue(item[key]);
    if (rows.length) return rows;
  }
  return [];
}

function candidate(provider: string, value: unknown, priority: number): Candidate | undefined {
  const rows = firstLyrics(value);
  if (!rows.length) return undefined;
  return { provider, lines: rows, synced: rows.some((line) => line.time !== undefined), priority };
}

async function getJson(url: URL, timeoutMs = 8_000): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { ...BROWSER_HEADERS } });
  if (!response.ok) throw new Error(`Lyrics source returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

/** Same as getJson but returns the raw text, for TTML and LRC bodies. */
async function getText(url: URL, timeoutMs = 8_000): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { ...BROWSER_HEADERS } });
  if (!response.ok) throw new Error(`Lyrics source returned ${response.status}`);
  return response.text();
}

function infoParams(url: URL, info: LyricsTrackInfo): void {
  url.searchParams.set('title', info.title);
  url.searchParams.set('artist', info.artist);
  if (info.album) url.searchParams.set('album', info.album);
  if (info.duration) url.searchParams.set('duration', String(Math.round(info.duration)));
  url.searchParams.set('id', info.id);
}

/**
 * YouLyPlus returns one row per line, with the time in milliseconds and a
 * syllable list for word level timing.
 */
function youLyPlusRows(value: unknown): TimedLyric[] {
  const rows: TimedLyric[] = [];
  const list = Array.isArray(value) ? value : [];
  for (const entry of list) {
    const item = record(entry);
    const text = String(item.text ?? '').trim();
    if (!text) continue;
    const rawTime = item.time;
    // The time is in milliseconds here, unlike the other providers.
    const time = typeof rawTime === 'number' && Number.isFinite(rawTime) ? rawTime / 1000 : timeValue(rawTime);
    rows.push({ ...(time === undefined ? {} : { time }), text });
  }
  return rows;
}

async function youLyPlus(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const responses = await Promise.allSettled(YOU_LY_PLUS.map(async (host) => {
    const url = new URL('/v2/lyrics/get', host);
    infoParams(url, info);
    const response = record(await getJson(url));
    const raw = response.lyrics ?? response.syncedLyrics ?? response.plainLyrics;
    if (Array.isArray(raw)) {
      const rows = youLyPlusRows(raw);
      if (rows.length) return { provider: 'YouLyPlus', lines: rows, synced: rows.some((row) => row.time !== undefined), priority: 0 };
    }
    return candidate('YouLyPlus', response.syncedLyrics ?? response.lyrics ?? response.plainLyrics, 0);
  }));
  const found = responses.flatMap((response) => response.status === 'fulfilled' && response.value ? [response.value] : []);
  return found.find((item) => item.synced) ?? found[0];
}


/**
 * Unison exposes a search endpoint that returns candidate tracks with
 * their video id, and a lookup endpoint that returns the lyrics for one
 * video id. The candidate has to be picked by title, artist and length
 * before the lyrics are fetched.
 */
async function unison(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const host = 'https://unison.boidu.dev';

  // The direct lookup works when the video id is known.
  const byVideo = new URL('/lyrics', host);
  byVideo.searchParams.set('v', info.id);
  try {
    const response = record(await getJson(byVideo));
    const data = record(response.data);
    const found = candidate('Unison', data.lyrics, 3);
    if (found) return found;
  } catch { /* This track has no lyrics here. */ }

  // Otherwise search for the song and pick the best matching recording.
  const search = new URL('/lyrics/search', host);
  search.searchParams.set('q', `${info.title} ${info.artist}`);
  let results: unknown[];
  try {
    const response = record(await getJson(search));
    results = Array.isArray(response.data) ? response.data as unknown[] : [];
  } catch {
    return undefined;
  }
  const candidates = results.map(record).filter((item) => item.videoId);
  if (!candidates.length) return undefined;

  const normalizedTitle = info.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedArtist = info.artist.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const score = (item: Record<string, unknown>): number => {
    const song = String(item.song ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const artist = String(item.artist ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const duration = Number(item.duration ?? 0);
    let value = 0;
    if (song === normalizedTitle) value += 6;
    else if (song.includes(normalizedTitle) || normalizedTitle.includes(song)) value += 3;
    if (artist.includes(normalizedArtist) || normalizedArtist.includes(artist)) value += 4;
    if (info.duration && duration) value -= Math.min(6, Math.abs(duration - info.duration) / 5);
    return value;
  };
  const ranked = candidates.map((item) => ({ item, value: score(item) })).sort((a, b) => b.value - a.value);
  if (!ranked.length || ranked[0]!.value <= 0) return undefined;

  for (const { item } of ranked.slice(0, 3)) {
    const url = new URL('/lyrics', host);
    url.searchParams.set('v', String(item.videoId));
    try {
      const response = record(await getJson(url));
      const data = record(response.data);
      const found = candidate('Unison', data.lyrics, 3);
      if (found) return found;
    } catch { /* Try the next candidate. */ }
  }
  return undefined;
}

async function betterLyrics(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const url = new URL('/getLyrics', 'https://lyrics-api.boidu.dev');
  url.searchParams.set('s', info.title);
  url.searchParams.set('a', info.artist);
  if (info.duration) url.searchParams.set('d', String(Math.round(info.duration)));
  if (info.album) url.searchParams.set('al', info.album);
  const response = record(await getJson(url));
  return candidate('BetterLyrics', response.ttml, 3);
}


/**
 * LRCLIB is the most reliable open source: it serves LRC files with
 * timestamps for most popular songs. The exact-match endpoint is tried
 * first, because the search endpoint often returns a different
 * recording of the same song.
 */
async function lrclib(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const artist = info.artist.split(/,| feat\.? | ft\.? /i)[0]!.trim();
  const exact = new URL('/api/get', 'https://lrclib.net');
  exact.searchParams.set('track_name', info.title);
  exact.searchParams.set('artist_name', artist);
  if (info.album) exact.searchParams.set('album_name', info.album);
  try {
    const response = record(await getJson(exact));
    const found = candidate('LRCLIB', response.syncedLyrics ?? response.plainLyrics, 2);
    if (found) return found;
  } catch { /* Fall through to the search endpoint. */ }

  const search = new URL('/api/search', 'https://lrclib.net');
  search.searchParams.set('track_name', info.title);
  search.searchParams.set('artist_name', artist);
  if (info.album) search.searchParams.set('album_name', info.album);
  const response = await getJson(search);
  if (!Array.isArray(response)) return undefined;
  const tracks = response.map(record).filter((item) => item.syncedLyrics || item.plainLyrics);
  // Prefer the recording that matches the length of the track being played.
  tracks.sort((a, b) => {
    const durationA = Number(a.duration ?? 0);
    const durationB = Number(b.duration ?? 0);
    return (info.duration ? Math.abs(durationA - info.duration) : 0) - (info.duration ? Math.abs(durationB - info.duration) : 0);
  });
  // A synced version of the right recording beats a plain one.
  const synced = tracks.find((item) => item.syncedLyrics);
  const chosen = synced ?? tracks[0];
  if (!chosen) return undefined;
  return candidate('LRCLIB', chosen.syncedLyrics ?? chosen.plainLyrics, 2);
}

/**
 * Lyrics.ovh serves plain lyrics with no timestamps. It is the fallback
 * that still gives the listener the words when nothing else works.
 */
async function lyricsOvh(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const artist = info.artist.split(/,| feat\.? | ft\.? /i)[0]!.trim();
  const url = new URL(`/v1/${encodeURIComponent(artist)}/${encodeURIComponent(info.title)}`, 'https://api.lyrics.ovh');
  const body = await getText(url);
  if (!body.trim()) return undefined;
  // The endpoint answers with JSON, but some mirrors answer with plain
  // text, so both are handled.
  const text = (() => {
    const trimmed = body.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return trimmed;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const item = record(parsed);
      return String(item.lyrics ?? item.text ?? item.plain ?? trimmed);
    } catch {
      return trimmed;
    }
  })();
  const rows = parseTextLyrics(text);
  if (!rows.length) return undefined;
  return { provider: 'Lyrics.ovh', lines: rows, synced: false, priority: 5 };
}

export async function fetchLyrics(music: MusicProvider, info: LyricsTrackInfo): Promise<LyricsResult | undefined> {
  const key = JSON.stringify([info.id, info.title, info.artist, info.duration, info.source, info.language]);
  const cached = lyricsCache.get(key);
  if (cached && cached.until > Date.now()) return cached.result;
  const existing = lyricsInFlight.get(key);
  if (existing) return existing;
  const operation = lyricsQueue.run(() => fetchLyricsUncached(music, info)).finally(() => lyricsInFlight.delete(key));
  lyricsInFlight.set(key, operation);
  return operation;
}

async function fetchLyricsUncached(music: MusicProvider, info: LyricsTrackInfo): Promise<LyricsResult | undefined> {
  // The order reflects how reliable each source is: the ones that return
  // word level timings come first, the plain-text fallback comes last.
  const sources: Record<string, () => Promise<Candidate | undefined>> = {
    YouLyPlus: () => youLyPlus(info),
    BetterLyrics: () => betterLyrics(info),
    LRCLIB: () => lrclib(info),
    Unison: () => unison(info),
    'Lyrics.ovh': () => lyricsOvh(info),
    'YouTube Music': () => Promise.race([
      music.getLyrics(info.id).then((value) => {
        // The YouTube lyrics response carries the plain text in
        // "description", which is a Text object with a "text" field, not a
        // string. firstLyrics() looks for named keys inside a response
        // object, so the text has to be handed over directly.
        const response = record(value);
        const description = response.description;
        const text = typeof description === 'string'
          ? description
          : typeof record(description).text === 'string' ? record(description).text as string : '';
        if (text.trim()) return candidate('YouTube Music', text, 6);
        return candidate('YouTube Music', value, 6);
      }),
      // The YouTube client has to start up before the first lookup, and the
      // catalog queue can be busy, so this needs more room than the plain
      // HTTP sources. Losing the race here would silently drop the only
      // source that serves YouTube's own lyrics.
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20_000)),
    ]),
  };
  const tasks = info.source && info.source !== 'auto' ? [sources[info.source]!()] : Object.values(sources).map((load) => load());
  const settled = await Promise.allSettled(tasks);
  const found = settled.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []).sort((a, b) => a.priority - b.priority);
  // A synced version always wins over a plain one, whatever its priority.
  const winner = found.find((item) => item.synced) ?? found[0];
  if (!winner) return undefined;
  const { lines, approximate } = await romanizeLyrics(winner.lines, info.language);
  const result: LyricsResult = { lines, provider: winner.provider, synced: winner.synced, approximate };
  for (const [key, entry] of lyricsCache) if (entry.until <= Date.now()) lyricsCache.delete(key);
  lyricsCache.set(JSON.stringify([info.id, info.title, info.artist, info.duration, info.source, info.language]), { result, until: Date.now() + CACHE_MS });
  if (lyricsCache.size > 50) {
    const oldest = lyricsCache.keys().next().value;
    if (oldest) lyricsCache.delete(oldest);
  }
  return result;
}
