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
const lyricsQueue = new TaskQueue(1);

const YOU_LY_PLUS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.atomix.one',
  'https://lyricsplus.binimum.org',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
  'https://lyrics-plus-backend.vercel.app',
];

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
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json', 'user-agent': 'AuroraMusic/1.0' } });
  if (!response.ok) throw new Error(`Lyrics source returned ${response.status}`);
  return response.json() as Promise<unknown>;
}

function infoParams(url: URL, info: LyricsTrackInfo): void {
  url.searchParams.set('title', info.title);
  url.searchParams.set('artist', info.artist);
  if (info.album) url.searchParams.set('album', info.album);
  if (info.duration) url.searchParams.set('duration', String(Math.round(info.duration)));
  url.searchParams.set('id', info.id);
}

async function youLyPlus(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const responses = await Promise.allSettled(YOU_LY_PLUS.map(async (host) => {
    const url = new URL('/v2/lyrics/get', host);
    infoParams(url, info);
    const response = record(await getJson(url));
    return candidate('YouLyPlus', response.syncedLyrics ?? response.lyrics ?? response.plainLyrics, 0);
  }));
  const found = responses.flatMap((response) => response.status === 'fulfilled' && response.value ? [response.value] : []);
  return found.find((item) => item.synced) ?? found[0];
}

async function paxsenix(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const search = new URL('/apple-music/search', 'https://lyrics.paxsenix.org');
  search.searchParams.set('q', `${info.title} ${info.artist}`);
  const results = await getJson(search);
  if (!Array.isArray(results)) return undefined;
  const normalizedTitle = info.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const normalizedArtist = info.artist.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  const ranked = results.map((entry) => record(entry)).sort((a, b) => {
    const score = (item: Record<string, unknown>) => {
      const title = String(item.trackName ?? item.songName ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
      const artist = String(item.artistName ?? '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
      const duration = Number(item.duration ?? 0);
      const durationSeconds = Number(item.duration ?? 0) > 10_000 ? Number(item.duration) / 1000 : Number(item.duration ?? 0);
      return Number(title === normalizedTitle || title.includes(normalizedTitle) || normalizedTitle.includes(title)) * 4
        + Number(artist.includes(normalizedArtist) || normalizedArtist.includes(artist)) * 3
        - (info.duration && durationSeconds ? Math.min(3, Math.abs(durationSeconds - info.duration) / 5) : 0);
    };
    return score(b) - score(a);
  }).slice(0, 4);
  const lyrics = await Promise.allSettled(ranked.map(async (item) => {
    const url = new URL('/apple-music/lyrics', 'https://lyrics.paxsenix.org');
    url.searchParams.set('id', String(item.id ?? ''));
    const data = record(await getJson(url));
    return candidate('Paxsenix', data.ttmlContent ?? data.elrcMultiPerson ?? data.elrc ?? data.plain ?? data.content, 1);
  }));
  const found = lyrics.flatMap((item) => item.status === 'fulfilled' && item.value ? [item.value] : []);
  return found.find((item) => item.synced) ?? found[0];
}

async function unison(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const url = new URL('/lyrics', 'https://unison.boidu.dev');
  url.searchParams.set('v', info.id);
  let response = record(await getJson(url));
  let data = record(response.data);
  if (!response.success || !data.lyrics) {
    const search = new URL('/lyrics', 'https://unison.boidu.dev');
    search.searchParams.set('song', info.title);
    search.searchParams.set('artist', info.artist);
    if (info.album) search.searchParams.set('album', info.album);
    if (info.duration) search.searchParams.set('duration', String(Math.round(info.duration)));
    response = record(await getJson(search));
    data = record(response.data);
  }
  return candidate('Unison', data.lyrics, 2);
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

async function simpMusic(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const roots = ['https://api-lyrics.simpmusic.org/v1/', 'https://vivi-yt-music-server.onrender.com/v1/'];
  for (const root of roots) {
    try {
      const response = record(await getJson(new URL(encodeURIComponent(info.id), root)));
      const tracks = Array.isArray(response.data) ? response.data.map(record) : [];
      const matching = tracks.sort((a, b) => {
        const durationA = Number(a.durationSeconds ?? 0); const durationB = Number(b.durationSeconds ?? 0);
        return (info.duration ? Math.abs(durationA - info.duration) : 0) - (info.duration ? Math.abs(durationB - info.duration) : 0);
      });
      const result = matching.map((item) => candidate('SimpMusic', item, 4)).find(Boolean);
      if (result) return result;
    } catch { /* Try the next community mirror. */ }
  }
  return undefined;
}

async function lrclib(info: LyricsTrackInfo): Promise<Candidate | undefined> {
  const url = new URL('/api/search', 'https://lrclib.net');
  url.searchParams.set('track_name', info.title);
  url.searchParams.set('artist_name', info.artist.split(/,| feat\.? | ft\.? /i)[0]!.trim());
  if (info.album) url.searchParams.set('album_name', info.album);
  const response = await getJson(url);
  if (!Array.isArray(response)) return undefined;
  const tracks = response.map(record).filter((item) => item.syncedLyrics || item.plainLyrics);
  tracks.sort((a, b) => {
    const durationA = Number(a.duration ?? 0); const durationB = Number(b.duration ?? 0);
    return (info.duration ? Math.abs(durationA - info.duration) : 0) - (info.duration ? Math.abs(durationB - info.duration) : 0);
  });
  return tracks.map((item) => candidate('LRCLIB', item.syncedLyrics ?? item.plainLyrics, 5)).find(Boolean);
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

  const sources: Record<string, () => Promise<Candidate | undefined>> = {
    YouLyPlus: () => youLyPlus(info), Paxsenix: () => paxsenix(info), Unison: () => unison(info), BetterLyrics: () => betterLyrics(info), SimpMusic: () => simpMusic(info), LRCLIB: () => lrclib(info),
    'YouTube Music': () => Promise.race([music.getLyrics(info.id).then((value) => candidate('YouTube Music', record(value).description ?? value, 6)), new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 9000))]),
  };
  const tasks = info.source && info.source !== 'auto' ? [sources[info.source]!()] : Object.values(sources).map((load) => load());
  const settled = await Promise.allSettled(tasks);
  const found = settled.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : []).sort((a, b) => a.priority - b.priority);
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
