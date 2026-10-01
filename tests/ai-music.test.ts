import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateMusicIdea } from '../server/services/ai';
import { rerankMusicCandidates } from '../server/services/typesafe';

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

describe('TypeSafe music ranking', () => {
  const tracks = [
    { id: 'song001', title: 'Fast Dance', artist: 'Artist A' },
    { id: 'song002', title: 'Rainy Evening', artist: 'Artist B' },
  ];

  it('sends one typed relevance question per catalog result and sorts by returned probability', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: {
      track_0: { type: 'noul', noul: 0.08 }, track_1: { type: 'noul', noul: 0.94 },
    } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await rerankMusicCandidates('soft songs for a rainy evening', tracks, 'test-key');
    expect(result).toEqual({ tracks: [tracks[1], tracks[0]], ranked: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-key');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('jev-latest');
    expect(body.questions.track_0.type).toBe('noul');
    expect(body.questions.track_1.instructions.candidate.title).toBe('Rainy Evening');
  });

  it('keeps the catalog order when TypeSafe is not configured or unavailable', async () => {
    const noKey = await rerankMusicCandidates('a vibe', tracks, '');
    expect(noKey).toEqual({ tracks, ranked: false });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const unavailable = await rerankMusicCandidates('a vibe', tracks, 'test-key');
    expect(unavailable).toEqual({ tracks, ranked: false });
  });
});
