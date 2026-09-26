import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { platform, tmpdir } from 'node:os';
import { z } from 'zod';
import type { AudioFormat, YtDlpStatus } from '../types.js';
import { TaskQueue } from './taskQueue.js';

const MAX_OUTPUT_BYTES = 1024 * 1024;
const extractionQueue = new TaskQueue(1);
const EXTRACTION_TIMEOUT_MS = 60_000;
const STATUS_TTL_MS = 60_000;
const AUDIO_CACHE_TTL_MS = 3 * 60_000;

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
  getAudioFormat(id: string, refresh?: boolean): Promise<AudioFormat>;
  readiness(force?: boolean): Promise<YtDlpStatus>;
  invalidate(id: string): void;
}

function commandSpec(): CommandSpec {
  const configured = process.env.YT_DLP_PATH?.trim();
  if (configured) {
    return { command: configured, prefix: [], label: path.basename(configured) || 'yt-dlp' };
  }
  if (platform() === 'win32') {
    return { command: 'py', prefix: ['-3', '-m', 'yt_dlp'], label: 'python -m yt_dlp' };
  }
  return { command: 'yt-dlp', prefix: [], label: 'yt-dlp' };
}

function run(command: string, args: readonly string[], timeout: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], {
      encoding: 'utf8',
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
      shell: false,
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
  const fallback = Date.now() + AUDIO_CACHE_TTL_MS;
  try {
    const expires = Number(new URL(url).searchParams.get('expire')) * 1_000;
    if (Number.isFinite(expires) && expires > Date.now()) {
      return Math.max(Date.now() + 15_000, Math.min(fallback, expires - 30_000));
    }
  } catch {
    // The URL has already been validated; use the conservative fallback.
  }
  return fallback;
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
  private statusCache?: { value: YtDlpStatus; expiresAt: number };
  private statusPromise?: Promise<YtDlpStatus>;

  invalidate(id: string): void {
    this.formats.delete(id);
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

  async getAudioFormat(id: string, refresh = false): Promise<AudioFormat> {
    const cached = this.formats.get(id);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.format;
    const existing = this.inFlight.get(id);
    if (existing) return existing;

    if (refresh) this.formats.delete(id);
    const operation = extractionQueue.run(() => this.extract(id)).finally(() => {
      if (this.inFlight.get(id) === operation) this.inFlight.delete(id);
    });
    this.inFlight.set(id, operation);
    return operation;
  }

  private async extract(id: string): Promise<AudioFormat> {
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
        '--remote-components',
        'ejs:github',
        '--dump-single-json',
        '--format',
        'bestaudio[ext=m4a]/bestaudio',
        '--',
        watchUrl,
      ], EXTRACTION_TIMEOUT_MS));
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
    this.formats.set(id, { format, expiresAt: cacheExpiry(format.url) });
    return format;
  }
}
