import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { platform, tmpdir } from 'node:os';
import { z } from 'zod';
import type { AudioFormat, YtDlpStatus } from '../types.js';
import { TaskQueue } from './taskQueue.js';
import { cachedAudio, cachedAudioPath, storeAudio } from './audioCache.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const extractionQueue = new TaskQueue(1);
const EXTRACTION_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const STATUS_TTL_MS = 60_000;
// Signed googlevideo URLs live for hours. Capping the cache at 3 minutes meant
// nearly every play re-ran the slow yt-dlp extraction; 30 minutes keeps replay
// and restart-warmed tracks instant while staying comfortably below expiry.
const AUDIO_CACHE_TTL_MS = 30 * 60_000;

const rawFormatSchema = z.object({
  url: z.string().url(),
  http_headers: z.record(z.string(), z.unknown()).optional(),
  mime_type: z.string().optional(),
  ext: z.string().optional(),
  filesize: z.number().nonnegative().optional(),
  filesize_approx: z.number().nonnegative().optional(),
}).passthrough();

interface CommandSpec {
  command: string;
  prefix: string[];
  label: string;
}

interface CacheEntry {
  format: AudioFormat;
  expiresAt: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface AudioExtractor {
  getAudioFormat(id: string, refresh?: boolean, quality?: AudioQuality, priority?: 'normal' | 'background'): Promise<AudioFormat>;
  warmAudioFormat?(id: string, quality?: AudioQuality): Promise<void>;
  /** Downloads the track to the local audio cache so it can be served with range support. */
  downloadAudio?(id: string, quality?: AudioQuality, signal?: AbortSignal): Promise<{ file: string; bytes: number }>;
  readiness(force?: boolean): Promise<YtDlpStatus>;
  invalidate(id: string): void;
}

export type AudioQuality = 'auto' | 'high' | 'data-saver';

export function formatSelector(quality: AudioQuality): string {
  if (quality === 'high') return 'bestaudio[abr>=128]/bestaudio[ext=m4a]/bestaudio';
  if (quality === 'data-saver') return 'bestaudio[abr<=64]/bestaudio[abr<=96]/worstaudio';
  return 'bestaudio[ext=m4a]/bestaudio';
}

export function commandSpec(): CommandSpec {
  const configured = process.env.YT_DLP_PATH?.trim();
  if (configured) {
    return { command: configured, prefix: [], label: path.basename(configured) || 'yt-dlp' };
  }
  if (platform() === 'win32') {
    return { command: 'py', prefix: ['-3', '-m', 'yt_dlp'], label: 'python -m yt_dlp' };
  }
  return { command: 'yt-dlp', prefix: [], label: 'yt-dlp' };
}

function run(command: string, args: readonly string[], timeout: number, signal?: AbortSignal): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      shell: false,
      signal,
      // YouTube's solver needs more than 96 MB even for a single audio track.
      // Extraction stays serialized so this budget is used by one job at a time.
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=160' },
    }, (error, stdout, stderr) => {
      if (error) {
        Object.assign(error, { stdout, stderr });
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function isAllowedMediaUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return host === 'googlevideo.com'
      || host.endsWith('.googlevideo.com')
      || host === 'youtube.com'
      || host.endsWith('.youtube.com')
      || host === 'googleusercontent.com'
      || host.endsWith('.googleusercontent.com');
  } catch {
    return false;
  }
}

function safeHeaders(value: Record<string, unknown> | undefined): Record<string, string> {
  const allowed = new Set(['accept', 'accept-language', 'cookie', 'origin', 'referer', 'user-agent']);
  const headers: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(value ?? {})) {
    if (!allowed.has(name.toLowerCase()) || typeof rawValue !== 'string') continue;
    if (/\r|\n/.test(rawValue) || rawValue.length > 8_192) continue;
    headers[name] = rawValue;
  }
  return headers;
}

function cacheExpiry(url: string): number {
  const ceiling = Date.now() + AUDIO_CACHE_TTL_MS;
  try {
    const expires = Number(new URL(url).searchParams.get('expire')) * 1_000;
    if (Number.isFinite(expires) && expires > Date.now()) {
      return Math.max(Date.now() + 15_000, Math.min(ceiling, expires - 30_000));
    }
  } catch {
    // The URL has already been validated; use the cache ceiling.
  }
  return ceiling;
}

function errorReason(error: unknown): string {
  const nodeError = error as NodeJS.ErrnoException & { stderr?: string };
  if (nodeError.code === 'ENOENT') return 'yt-dlp executable was not found.';
  if ((error as { killed?: boolean } | undefined)?.killed || nodeError.code === 'ETIMEDOUT') {
    return 'yt-dlp readiness check timed out.';
  }
  const stderrLines = typeof nodeError.stderr === 'string' ? nodeError.stderr.trim().split(/\r?\n/) : [];
  const stderr = stderrLines[stderrLines.length - 1] ?? '';
  return stderr?.slice(0, 200) || 'yt-dlp could not be started.';
}

export class YtDlpService implements AudioExtractor {
  private readonly formats = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<AudioFormat>>();
  private readonly warmings = new Map<string, AbortController>();
  private statusCache?: { value: YtDlpStatus; expiresAt: number };
  private statusPromise?: Promise<YtDlpStatus>;

  invalidate(id: string): void {
    for (const key of this.formats.keys()) if (key.startsWith(`${id}:`)) this.formats.delete(key);
  }

  async readiness(force = false): Promise<YtDlpStatus> {
    if (!force && this.statusCache && this.statusCache.expiresAt > Date.now()) return this.statusCache.value;
    if (!force && this.statusPromise) return this.statusPromise;

    const spec = commandSpec();
    const operation = run(spec.command, [...spec.prefix, '--version'], 8_000)
      .then(({ stdout }) => ({
        ready: true,
        command: spec.label,
        version: stdout.trim().split(/\s+/)[0] || 'unknown',
      } satisfies YtDlpStatus))
      .catch((error: unknown) => ({
        ready: false,
        command: spec.label,
        reason: errorReason(error),
      } satisfies YtDlpStatus))
      .then((status) => {
        this.statusCache = { value: status, expiresAt: Date.now() + STATUS_TTL_MS };
        return status;
      })
      .finally(() => {
        this.statusPromise = undefined;
      });

    this.statusPromise = operation;
    return operation;
  }

  async getAudioFormat(id: string, refresh = false, quality: AudioQuality = 'auto', priority: 'normal' | 'background' = 'normal'): Promise<AudioFormat> {
    const key = `${id}:${quality}`;
    const cached = this.formats.get(key);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.format;
    if (priority === 'background') {
      if (refresh) this.formats.delete(key);
      await this.warmAudioFormat(id, quality);
      const prepared = this.formats.get(key);
      if (!prepared) throw new Error('Next-song preparation was interrupted by playback.');
      return prepared.format;
    }
    // Keep speculative work from delaying the song the listener just selected.
    for (const [warmKey, controller] of this.warmings) if (warmKey !== key) controller.abort();
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    if (refresh) this.formats.delete(key);
    const operation = extractionQueue.run(() => this.extract(id, quality)).finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    });
    this.inFlight.set(key, operation);
    return operation;
  }

  async warmAudioFormat(id: string, quality: AudioQuality = 'auto'): Promise<void> {
    const key = `${id}:${quality}`;
    if (this.formats.get(key)?.expiresAt && this.formats.get(key)!.expiresAt > Date.now()) return;
    if (this.inFlight.has(key)) { await this.inFlight.get(key); return; }
    const controller = new AbortController();
    this.warmings.set(key, controller);
    const operation = extractionQueue.run(() => this.extract(id, quality, controller.signal), 'background');
    this.inFlight.set(key, operation);
    try { await operation; }
    catch (error) { if (!controller.signal.aborted) throw error; }
    finally {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
      if (this.warmings.get(key) === controller) this.warmings.delete(key);
    }
  }

  private async extract(id: string, quality: AudioQuality, signal?: AbortSignal): Promise<AudioFormat> {
    signal?.throwIfAborted();
    const spec = commandSpec();
    const watchUrl = `https://www.youtube.com/watch?v=${id}`;
    const cookieFile = process.env.YT_DLP_COOKIE_FILE?.trim();
    let cookieTempDir: string | undefined;
    let cookieArgs: string[] = [];
    if (cookieFile) {
      cookieTempDir = await mkdtemp(path.join(tmpdir(), 'aurora-ytdlp-'));
      const writableCookieFile = path.join(cookieTempDir, 'cookies.txt');
      try {
        await copyFile(cookieFile, writableCookieFile);
        await chmod(writableCookieFile, 0o600);
        cookieArgs = ['--cookies', writableCookieFile];
      } catch (error) {
        await rm(cookieTempDir, { recursive: true, force: true });
        throw error;
      }
    }

    let stdout: string;
    try {
      ({ stdout } = await run(spec.command, [
        ...spec.prefix,
        ...cookieArgs,
        '--no-playlist',
        '--skip-download',
        '--force-ipv4',
        '--socket-timeout',
        '10',
        '--retries',
        '1',
        '--extractor-retries',
        '1',
        '--js-runtimes',
        process.env.YT_DLP_JS_RUNTIME?.trim() || `node:${process.execPath}`,
        '--dump-single-json',
        '--format',
        formatSelector(quality),
        '--',
        watchUrl,
      ], EXTRACTION_TIMEOUT_MS, signal));
    } finally {
      if (cookieTempDir) await rm(cookieTempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new Error('yt-dlp returned malformed metadata.');
    }

    const root = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const requested = Array.isArray(root.requested_downloads) ? root.requested_downloads[0] : undefined;
    const result = rawFormatSchema.safeParse(requested ?? root);
    if (!result.success || !isAllowedMediaUrl(result.data?.url ?? '')) {
      throw new Error('yt-dlp did not return a safe playable audio URL.');
    }

    const format: AudioFormat = {
      url: result.data.url,
      mimeType: result.data.mime_type || (result.data.ext === 'm4a' ? 'audio/mp4' : undefined),
      contentLength: result.data.filesize ?? result.data.filesize_approx,
      httpHeaders: safeHeaders(result.data.http_headers),
    };
    for (const [key, entry] of this.formats) if (entry.expiresAt <= Date.now()) this.formats.delete(key);
    if (this.formats.size >= 100) {
      const oldest = this.formats.keys().next().value;
      if (oldest) this.formats.delete(oldest);
    }
    this.formats.set(`${id}:${quality}`, { format, expiresAt: cacheExpiry(format.url) });
    return format;
  }

  /**
   * Downloads a track into the local audio cache.
   *
   * The signed YouTube media URL is bound to the address that fetched it,
   * so it cannot be handed to a browser or re-fetched later: it comes back
   * 403. Downloading once on the server and serving the local file keeps
   * playback, seeking and the next-song preload working.
   */
  async downloadAudio(id: string, quality: AudioQuality = 'auto', signal?: AbortSignal): Promise<{ file: string; bytes: number }> {
    const existing = await cachedAudio(id);
    if (existing) return existing;

    const spec = commandSpec();
    const cookieFile = process.env.YT_DLP_COOKIE_FILE?.trim();
    let cookieTempDir: string | undefined;
    let cookieArgs: string[] = [];
    if (cookieFile) {
      cookieTempDir = await mkdtemp(path.join(tmpdir(), 'aurora-ytdlp-'));
      const writableCookieFile = path.join(cookieTempDir, 'cookies.txt');
      try {
        await copyFile(cookieFile, writableCookieFile);
        await chmod(writableCookieFile, 0o600);
        cookieArgs = ['--cookies', writableCookieFile];
      } catch (error) {
        await rm(cookieTempDir, { recursive: true, force: true });
        throw error;
      }
    }

    // yt-dlp appends the container extension to an output template, so the
    // real file name is only known after the move. Ask for it explicitly.
    const workDir = await mkdtemp(path.join(tmpdir(), 'aurora-dl-'));
    const template = path.join(workDir, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.%(ext)s`);
    try {
      const { stdout } = await run(spec.command, [
        ...spec.prefix,
        ...cookieArgs,
        '--no-playlist',
        '--force-ipv4',
        '--socket-timeout',
        '15',
        '--retries',
        '2',
        '--extractor-retries',
        '2',
        '--js-runtimes',
        process.env.YT_DLP_JS_RUNTIME?.trim() || `node:${process.execPath}`,
        '--no-part',
        '--no-mtime',
        '--print',
        'after_move:filepath',
        '--output',
        template,
        '--format',
        formatSelector(quality),
        '--',
        `https://www.youtube.com/watch?v=${id}`,
      ], DOWNLOAD_TIMEOUT_MS, signal);

      const produced = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (!produced) throw new Error('yt-dlp did not report a downloaded file.');
      const info = await stat(produced).catch(() => undefined);
      if (!info || info.size === 0) throw new Error('yt-dlp did not download an audio file.');

      const target = cachedAudioPath(id);
      await copyFile(produced, target);
      await chmod(target, 0o600);
      await storeAudio(id, target, info.size);
      return { file: target, bytes: info.size };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      if (cookieTempDir) await rm(cookieTempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
