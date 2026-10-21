// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchLyrics } from '../server/services/lyrics';
import type { MusicProvider } from '../server/services/youtube';

afterEach(() => vi.unstubAllGlobals());

const provider = { getLyrics: vi.fn().mockResolvedValue(undefined) } as unknown as MusicProvider;

function mockJson(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

function mockText(body: string, status = 200): void {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(body, { status })));
}

describe('lyrics providers', () => {
  it('reads YouLyPlus rows whose times are in milliseconds', async () => {
    mockJson({ lyrics: [{ time: 38466, text: 'They told him' }, { time: 40144, text: 'don’t come around here' }] });
    const result = await fetchLyrics(provider, { id: 'x', title: 'Beat It', artist: 'Michael Jackson', source: 'YouLyPlus' });
    expect(result?.provider).toBe('YouLyPlus');
    expect(result?.synced).toBe(true);
    // 38466 ms is 38.466 seconds, not 38466 seconds.
    expect(result!.lines[0]!.time).toBeCloseTo(38.466, 2);
    expect(result!.lines[1]!.time).toBeCloseTo(40.144, 2);
  });

  it('reads an LRC file from LRCLIB', async () => {
    mockJson({ syncedLyrics: '[00:38.20] They told him\n[00:41.16] Don’t wanna see your face' });
    const result = await fetchLyrics(provider, { id: 'x', title: 'Beat It', artist: 'Michael Jackson', source: 'LRCLIB' });
    expect(result?.provider).toBe('LRCLIB');
    expect(result?.synced).toBe(true);
    expect(result!.lines[0]!.time).toBeCloseTo(38.2, 1);
    expect(result!.lines[0]!.text).toBe('They told him');
  });

  it('reads plain lyrics from Lyrics.ovh', async () => {
    mockText('They told him don’t ever come around here\nDon’t wanna see your face');
    const result = await fetchLyrics(provider, { id: 'x', title: 'Beat It', artist: 'Michael Jackson', source: 'Lyrics.ovh' });
    expect(result?.provider).toBe('Lyrics.ovh');
    expect(result?.synced).toBe(false);
    expect(result!.lines.length).toBe(2);
  });

  it('reads word level TTML from BetterLyrics', async () => {
    const ttml = '<tt xmlns="http://www.w3.org/ns/ttml"><body dur="4:18"><div begin="38.455" end="51.163"><p begin="38.455" end="41.0">They told him</p></div></body></tt>';
    mockJson({ ttml });
    const result = await fetchLyrics(provider, { id: 'x', title: 'Beat It', artist: 'Michael Jackson', source: 'BetterLyrics' });
    expect(result?.provider).toBe('BetterLyrics');
    expect(result?.synced).toBe(true);
    expect(result!.lines[0]!.text).toBe('They told him');
  });

  it('reads the plain lyrics YouTube Music returns in its description field', async () => {
    // The real response carries a Text object, not a string.
    const ytProvider = { getLyrics: vi.fn().mockResolvedValue({
      type: 'MusicDescriptionShelf',
      description: {
        text: 'They told him don\'t ever come around here\r\nDon\'t wanna see your face',
        runs: [{ text: 'They told him don\'t ever come around here' }],
      },
    }) } as unknown as MusicProvider;
    const result = await fetchLyrics(ytProvider, { id: 'x', title: 'Beat It', artist: 'Michael Jackson', source: 'YouTube Music' });
    expect(result?.provider).toBe('YouTube Music');
    expect(result?.synced).toBe(false);
    expect(result!.lines.length).toBe(2);
    expect(result!.lines[0]!.text).toContain('They told him');
  });

  it('also reads a plain string description from YouTube Music', async () => {
    const ytProvider = { getLyrics: vi.fn().mockResolvedValue({ description: 'Only one line' }) } as unknown as MusicProvider;
    const result = await fetchLyrics(ytProvider, { id: 'y', title: 'Beat It', artist: 'Michael Jackson', source: 'YouTube Music' });
    expect(result?.provider).toBe('YouTube Music');
    expect(result!.lines[0]!.text).toBe('Only one line');
  });

  it('falls back to a plain source when the timed ones fail', async () => {
    // The timed sources answer with an error, the plain one works.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('lyrics.ovh')) return new Response('The words', { status: 200 });
      return new Response('nope', { status: 500 });
    }));
    const result = await fetchLyrics(provider, { id: 'x', title: 'Beat It', artist: 'Michael Jackson', source: 'auto' });
    expect(result?.provider).toBe('Lyrics.ovh');
    expect(result?.synced).toBe(false);
  });
});
