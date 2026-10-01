import { afterEach, describe, expect, it, vi } from 'vitest';
import { keylessChat, suggestMusic } from '../src/lib/keylessAi';
import { publicWebUrl, searchReference } from '../server/services/webTools';

afterEach(() => vi.unstubAllGlobals());

describe('browser keyless AI and public web tools', () => {
  it('calls LLM7 without a key and parses suggested song searches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{"title":"Night drive","description":"Soft tracks","queries":["one artist","two artist"]}\n```' } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await suggestMusic('late night', 'create', []);
    expect(result.queries).toEqual(['one artist', 'two artist']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.llm7.io/v1/chat/completions');
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer unused' });
  });

  it('reports provider rate limits so the mix can use catalog fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(keylessChat([{ role: 'user', content: 'hi' }])).rejects.toThrow(/free limit/i);
  });

  it('refuses internal and credential-bearing URLs', () => {
    for (const url of ['http://example.org', 'https://127.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://intranet.local/', 'https://name:pass@example.org/']) {
      expect(() => publicWebUrl(url)).toThrow();
    }
    expect(publicWebUrl('https://en.wikipedia.org/wiki/Jazz#History')).toBe('https://en.wikipedia.org/wiki/Jazz');
  });

  it('turns a reference search into visible source links', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ query: { search: [{ title: 'Jazz', snippet: '<span class="searchmatch">Jazz</span> is music.' }] } }), { status: 200 })));
    expect(await searchReference('jazz')).toEqual([{ title: 'Jazz', snippet: 'Jazz is music.', url: 'https://en.wikipedia.org/wiki/Jazz' }]);
  });
});
