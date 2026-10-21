import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

/**
 * On-disk cache for resolved audio.
 *
 * YouTube's signed media URLs are bound to the address that requested them,
 * so a URL handed to a browser (or re-fetched by the server) can come back
 * 403. yt-dlp's own downloader can always fetch it, so the server downloads
 * the track once and serves the local file afterwards. That also makes the
 * next song available immediately: the file is already on disk when the
 * player asks for it, so preloading is instant and seeking works.
 */

const CACHE_DIR = path.join(tmpdir(), 'aurora-audio-cache');
const MAX_ENTRIES = 24;
const MAX_BYTES = 200 * 1024 * 1024;

export interface ByteRange { start: number; end: number; length: number; partial: boolean }

export function parseRangeHeader(header: string | undefined): { start: number | undefined; end: number | undefined } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;
  if (!rawStart) {
    const length = Number(rawEnd);
    if (!Number.isFinite(length) || length <= 0) return null;
    return { start: undefined, end: length };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start < 0) return null;
  if (!rawEnd) return { start, end: undefined };
  const end = Number(rawEnd);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

export function resolveRange(range: { start: number | undefined; end: number | undefined } | null, size: number): ByteRange | null {
  if (size <= 0) return null;
  if (!range) return { start: 0, end: size - 1, length: size, partial: false };
  if (range.start === undefined) {
    const length = Math.min(range.end ?? 0, size);
    if (length <= 0) return null;
    return { start: size - length, end: size - 1, length, partial: true };
  }
  if (range.start >= size) return null;
  const end = range.end === undefined ? size - 1 : Math.min(range.end, size - 1);
  if (end < range.start) return null;
  return { start: range.start, end, length: end - range.start + 1, partial: true };
}

/** Files currently held in the cache, oldest first. */
const entries: Array<{ id: string; file: string; bytes: number; touchedAt: number }> = [];

function entryFor(id: string): (typeof entries)[number] | undefined {
  return entries.find((entry) => entry.id === id);
}

export function cachedAudioPath(id: string): string {
  return path.join(CACHE_DIR, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.audio`);
}

/**
 * The content type of a cached file.
 *
 * yt-dlp usually downloads AAC audio in an MP4 container. Serving that as
 * audio/mpeg makes the browser try to decode AAC as MP3, and playback
 * silently never starts. The type has to match the real container, so the
 * cached file keeps the extension it was downloaded with.
 */
export function audioContentType(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.m4a' || ext === '.m4b' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.webm' || ext === '.opus' || ext === '.ogg') return 'audio/ogg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.mp3') return 'audio/mpeg';
  return undefined;
}

/** The container extensions a cached track can have. */
const CONTAINERS = ['.m4a', '.mp4', '.webm', '.opus', '.ogg', '.wav', '.flac', '.mp3'];

/** Every cached file for an id, whichever container it was stored in. */
function candidatePaths(id: string): string[] {
  const base = id.replace(/[^A-Za-z0-9_-]/g, '');
  const paths = CONTAINERS.map((ext) => path.join(CACHE_DIR, `${base}${ext}`));
  paths.push(path.join(CACHE_DIR, `${base}.audio`));
  return paths;
}

export async function cachedAudio(id: string): Promise<{ file: string; bytes: number } | undefined> {
  const entry = entryFor(id);
  if (entry) {
    try {
      const info = await stat(entry.file);
      entry.touchedAt = Date.now();
      return { file: entry.file, bytes: info.size };
    } catch {
      const index = entries.indexOf(entry);
      if (index >= 0) entries.splice(index, 1);
      return undefined;
    }
  }
  // The index lives in memory, so a restarted server does not know about
  // files that are already on disk. Check the disk before declaring a miss,
  // otherwise every restart re-downloads the whole library.
  for (const file of candidatePaths(id)) {
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size === 0) continue;
      entries.push({ id, file, bytes: info.size, touchedAt: Date.now() });
      return { file, bytes: info.size };
    } catch {
      // try the next container
    }
  }
  return undefined;
}

/** Registers a downloaded file in the cache and evicts the oldest entries. */
export async function storeAudio(id: string, file: string, bytes: number): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  // Keep the container extension: the content type the browser needs is
  // derived from it.
  const ext = path.extname(file).toLowerCase();
  const target = CONTAINERS.includes(ext)
    ? path.join(CACHE_DIR, `${id.replace(/[^A-Za-z0-9_-]/g, '')}${ext}`)
    : cachedAudioPath(id);
  if (path.resolve(target) !== path.resolve(file)) {
    await copyFile(file, target);
    await chmod(target, 0o600);
  }
  // Remove any other container left over for this id.
  for (const other of candidatePaths(id)) {
    if (path.resolve(other) !== path.resolve(target)) await unlink(other).catch(() => undefined);
  }
  const existing = entryFor(id);
  if (existing) { existing.file = target; existing.bytes = bytes; existing.touchedAt = Date.now(); }
  else entries.push({ id, file: target, bytes, touchedAt: Date.now() });
  await evict();
}

async function evict(): Promise<void> {
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  while (entries.length > MAX_ENTRIES || total > MAX_BYTES) {
    const oldest = entries.sort((a, b) => a.touchedAt - b.touchedAt)[0];
    if (!oldest) break;
    entries.splice(entries.indexOf(oldest), 1);
    total -= oldest.bytes;
    await unlink(oldest.file).catch(() => undefined);
  }
}

/** Streams a byte range of a cached file to an HTTP response. */
export async function serveCachedAudio(
  id: string,
  rangeHeader: string | undefined,
  respond: (status: number, headers: Record<string, string>) => void,
  pipe: (stream: NodeJS.ReadableStream) => void,
): Promise<boolean> {
  const cached = await cachedAudio(id);
  if (!cached) return false;
  const range = resolveRange(parseRangeHeader(rangeHeader), cached.bytes);
  if (!range) {
    respond(416, { 'Content-Range': `bytes */${cached.bytes}` });
    return true;
  }
  const headers: Record<string, string> = {
    'Content-Type': audioContentType(cached.file) ?? 'audio/mpeg',
    'Content-Length': String(range.length),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${cached.bytes}`;
  respond(range.partial ? 206 : 200, headers);
  pipe(createReadStream(cached.file, { start: range.start, end: range.end }));
  return true;
}
