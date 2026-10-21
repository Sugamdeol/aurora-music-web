// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { romanizeLyrics } from '../server/services/romanization';
import { fetchLyrics } from '../server/services/lyrics';
import type { MusicProvider } from '../server/services/youtube';
afterEach(() => vi.unstubAllGlobals());

describe('script-aware romanization', () => {
  it('keeps Latin words and timing unchanged, and removes Hindi inherent final schwa', async () => {
    const result = await romanizeLyrics([{ time: 12.5, text: 'दिल मेरा data' }, { text: 'Hello, world!' }], 'hindi');
    expect(result.lines[0]).toMatchObject({ time: 12.5, text: 'दिल मेरा data', romanized: 'dil mera data' });
    expect(result.lines[1]).toEqual({ time: undefined, text: 'Hello, world!' });
  });
  it.each(['ਪੰਜਾਬੀ', 'বাংলা', 'മലയാളം', 'తెలుగు', 'ಕನ್ನಡ', 'ગુજરાતી', 'தமிழ்', '안녕', '你好', 'Привет'])('converts %s without dropping the original', async (text) => {
    const result = await romanizeLyrics([{ text }]);
    expect(result.lines[0].text).toBe(text);
    expect(result.lines[0].romanized).toMatch(/[A-Za-z]/);
    expect(result.lines[0].romanized).not.toBe(text);
  });
  it('uses Japanese for kanji-only lines in a song with kana', async () => {
    const result = await romanizeLyrics([{ text: 'こんにちは' }, { text: '世界' }]);
    expect(result.approximate).toBe(false);
    expect(result.lines[1].romanized).toMatch(/sekai/i);
  }, 15000);
  it('supports explicit Cantonese and marks generic Arabic conversion as approximate', async () => {
    expect((await romanizeLyrics([{ text: '你好' }], 'cantonese')).lines[0].romanized).toContain('nei');
    const arabic = await romanizeLyrics([{ text: 'مرحبا' }], 'arabic');
    expect(arabic.approximate).toBe(true);
    expect(arabic.lines[0].romanized).toMatch(/[a-z]/i);
  });
});

it('honours an explicit provider and caches it separately from another language', async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify([{ syncedLyrics: '[00:01.00] दिल मेरा' }]), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const getLyrics = vi.fn();
  const provider = { getLyrics } as unknown as MusicProvider;
  const info = { id: 'source-test', title: 'Test', artist: 'Test', source: 'LRCLIB', language: 'hindi' as const };
  expect((await fetchLyrics(provider, info))?.provider).toBe('LRCLIB');
  const callsAfterFirst = fetchMock.mock.calls.length;
  // The same request is served from the cache, without a second call.
  await fetchLyrics(provider, info);
  expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  await fetchLyrics(provider, { ...info, language: 'marathi' });
  expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  expect(getLyrics).not.toHaveBeenCalled();
});
