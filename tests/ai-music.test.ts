import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMusicIdea } from '../server/services/ai';

afterEach(() => vi.unstubAllGlobals());

describe('keyless music suggestions', () => {
  it('sends the selected mood and track seeds and constrains the model output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ title: 'Evening mix', description: 'A soft mix', queries: ['song a singer a', 'song a singer a', 'song b singer b'] }) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const idea = await generateMusicIdea('rainy night', ['Seed — Artist'], 'extend');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.llm7.io/v1/chat/completions');
    expect(JSON.parse(String(init.body)).messages[1].content).toContain('Seed — Artist');
    expect(idea.queries).toEqual(['song a singer a', 'song b singer b']);
  });

  it('rejects malformed model output instead of saving invented tracks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'sorry' } }] }), { status: 200 })));
    await expect(generateMusicIdea('rainy night', [], 'create')).rejects.toMatchObject({ status: 502 });
  });
});
