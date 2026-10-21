// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import type { AudioExtractor } from '../server/services/ytdlp';
import type { MusicProvider } from '../server/services/youtube';

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('track download', () => {
  const format = { url: 'https://r1.googlevideo.com/audio', httpHeaders: {}, mimeType: 'audio/mp4' };
  function app() {
    const audio: AudioExtractor = {
      getAudioFormat: vi.fn().mockResolvedValue(format),
      invalidate: vi.fn(),
      readiness: vi.fn().mockResolvedValue({ ready: true, command: 'yt-dlp' }),
    };
    return { audio, server: createApp({ music: {} as MusicProvider, audio }) };
  }

  it('serves a full download as an attachment named after the song', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mp4', 'Content-Length': '3' },
    })));
    const { server } = app();
    const result = await request(server).get('/api/v1/download/testdl000000001?title=Night%20Drive&artist=Asha%20Bhosle');
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('audio/mp4');
    expect(result.headers['content-length']).toBe('3');
    expect(result.headers['content-disposition']).toBe(
      'attachment; filename="Asha Bhosle - Night Drive.m4a"; filename*=UTF-8\'\'Asha%20Bhosle%20-%20Night%20Drive.m4a',
    );
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body).toEqual(Buffer.from([1, 2, 3]));
  });

  it('sanitizes hostile titles and falls back to the video id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mp4' },
    })));
    const { server } = app();
    const hostile = await request(server).get('/api/v1/download/testdl000000001').query({ title: '..\\..\\etc "pass" <x>', artist: '' });
    expect(hostile.status).toBe(200);
    const disposition = hostile.headers['content-disposition'];
    expect(disposition).toContain('attachment');
    expect(disposition).not.toContain('..');
    expect(disposition).not.toContain('"pass"');
    expect(disposition).toContain('.m4a');

    const bare = await request(server).get('/api/v1/download/testdl000000001');
    expect(bare.headers['content-disposition']).toContain('testdl000000001.m4a');
  });

  it('passes the requested quality to the extractor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([1]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mp4' },
    })));
    const { audio, server } = app();
    await request(server).get('/api/v1/download/testdl000000001?quality=high&title=X');
    expect(audio.getAudioFormat).toHaveBeenCalledWith('testdl000000001', false, 'high');
  });

  it('invalidates a stale format and retries once before failing', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5]), { status: 200, headers: { 'Content-Type': 'audio/mp4' } }));
    vi.stubGlobal('fetch', fetch);
    const { audio, server } = app();
    const result = await request(server).get('/api/v1/download/testdl000000001?title=Retry');
    expect(result.status).toBe(200);
    expect(result.body).toEqual(Buffer.from([4, 5]));
    expect(audio.invalidate).toHaveBeenCalledWith('testdl000000001');
    expect(audio.getAudioFormat).toHaveBeenNthCalledWith(1, 'testdl000000001', false, 'auto');
    expect(audio.getAudioFormat).toHaveBeenNthCalledWith(2, 'testdl000000001', true, 'auto');
  });

  it('surfaces an upstream failure as an error instead of an empty file', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { server } = app();
    const result = await request(server).get('/api/v1/download/testdl000000001?title=X');
    expect(result.status).toBe(502);
    expect(result.body.error.code).toBe('UPSTREAM_ERROR');
    vi.restoreAllMocks();
  });
});
