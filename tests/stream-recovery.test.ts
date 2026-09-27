// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { YtDlpService, formatSelector, type AudioExtractor } from '../server/services/ytdlp';
import type { MusicProvider } from '../server/services/youtube';

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('song extraction', () => {
  it('selects distinct audio quality formats and reuses each signed URL independently', async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ url: 'https://r1.googlevideo.com/audio', ext: 'm4a' }), '');
    });
    const extractor = new YtDlpService();
    await extractor.getAudioFormat('mhSpdlCXU7M', false, 'data-saver');
    expect((execFile.mock.calls[0][1] as string[]).slice(-3, -2)).toEqual([formatSelector('data-saver')]);
    await extractor.getAudioFormat('mhSpdlCXU7M', false, 'data-saver');
    await extractor.getAudioFormat('mhSpdlCXU7M', false, 'high');
    expect(execFile).toHaveBeenCalledTimes(2);
  });
  it('uses IPv4, bounded network retries and an explicit JavaScript runtime', async () => {
    execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, JSON.stringify({ url: 'https://r1.googlevideo.com/audio', ext: 'm4a' }), '');
    });
    const extractor = new YtDlpService();
    expect((await extractor.getAudioFormat('mhSpdlCXU7M')).mimeType).toBe('audio/mp4');
    const args = execFile.mock.calls[0][1] as string[];
    expect(args).toContain('--force-ipv4');
    expect(args.slice(args.indexOf('--socket-timeout'), args.indexOf('--socket-timeout') + 2)).toEqual(['--socket-timeout', '10']);
    expect(args).toContain('--js-runtimes');
    expect(args).not.toContain('--remote-components');
    await extractor.getAudioFormat('mhSpdlCXU7M');
    expect(execFile).toHaveBeenCalledTimes(1);
  });
  it('lets a tapped song interrupt an unrelated background warm', async () => {
    let backgroundSignal: AbortSignal | undefined;
    execFile.mockImplementation((_command, args, options, callback) => {
      if (args.some((arg: string) => arg.includes('watch?v=background'))) {
        backgroundSignal = options.signal;
        options.signal.addEventListener('abort', () => callback(new Error('cancelled'), '', ''), { once: true });
      } else callback(null, JSON.stringify({ url: 'https://r1.googlevideo.com/audio', ext: 'm4a' }), '');
    });
    const extractor = new YtDlpService();
    const warm = extractor.warmAudioFormat('background');
    const selected = extractor.getAudioFormat('selected');
    await expect(selected).resolves.toMatchObject({ mimeType: 'audio/mp4' });
    await expect(warm).resolves.toBeUndefined();
    expect(backgroundSignal?.aborted).toBe(true);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
  it('promotes a queued warm when that song is selected', async () => {
    execFile.mockImplementation((_command, args, options, callback) => {
      if (args.some((arg: string) => arg.includes('watch?v=background'))) {
        options.signal.addEventListener('abort', () => callback(new Error('cancelled'), '', ''), { once: true });
      } else callback(null, JSON.stringify({ url: 'https://r1.googlevideo.com/audio', ext: 'm4a' }), '');
    });
    const extractor = new YtDlpService();
    const oldWarm = extractor.warmAudioFormat('background');
    const newWarm = extractor.warmAudioFormat('selected');
    await expect(extractor.getAudioFormat('selected')).resolves.toMatchObject({ mimeType: 'audio/mp4' });
    await Promise.all([oldWarm, newWarm]);
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});

describe('stream recovery', () => {
  const format = { url: 'https://r1.googlevideo.com/audio', httpHeaders: {}, mimeType: 'audio/mp4' };
  function app() {
    const audio: AudioExtractor = {
      getAudioFormat: vi.fn().mockResolvedValue(format),
      invalidate: vi.fn(),
      readiness: vi.fn().mockResolvedValue({ ready: true, command: 'yt-dlp' }),
    };
    return { audio, server: createApp({ music: {} as MusicProvider, audio }) };
  }

  it('retries a failed connection and preserves the requested byte range', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: { 'Content-Type': 'audio/mp4', 'Content-Range': 'bytes 0-2/300', 'Content-Length': '3', 'Accept-Ranges': 'bytes' },
    }));
    vi.stubGlobal('fetch', fetch);
    const { audio, server } = app();
    const result = await request(server).get('/api/v1/stream/mhSpdlCXU7M').set('Range', 'bytes=0-2');
    expect(result.status).toBe(206);
    expect(result.headers['content-range']).toBe('bytes 0-2/300');
    expect(result.headers['content-type']).toBe('audio/mp4');
    expect(result.headers['cache-control']).toBe('no-store');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1][1].headers as Headers).get('Range')).toBe('bytes=0-2');
    expect(audio.invalidate).toHaveBeenCalledWith('mhSpdlCXU7M');
    expect(audio.getAudioFormat).toHaveBeenLastCalledWith('mhSpdlCXU7M', true);
  });

  it('returns an error for an upstream abort instead of leaving the browser hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Connection aborted', 'AbortError')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { server } = app();
    const result = await request(server).get('/api/v1/stream/mhSpdlCXU7M');
    expect(result.status).toBe(502);
    expect(result.body.error.code).toBe('UPSTREAM_ERROR');
    vi.restoreAllMocks();
  });
});
