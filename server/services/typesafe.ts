type MusicCandidate = {
  id: string;
  title: string;
  artist: string;
  album?: string;
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : {};
}

/**
 * Re-rank a small catalog shortlist for a listener's request.
 * TypeSafe is an optional, best-effort semantic layer: a missing key or upstream
 * failure leaves the original catalog order untouched.
 */
export async function rerankMusicCandidates(
  prompt: string,
  candidates: MusicCandidate[],
  apiKey = process.env.TYPESAFE_API_KEY?.trim(),
): Promise<{ tracks: MusicCandidate[]; ranked: boolean }> {
  if (!apiKey || candidates.length < 2) return { tracks: candidates, ranked: false };

  const shortlist = candidates.slice(0, 20);
  const questions = Object.fromEntries(shortlist.map((candidate, index) => [`track_${index}`, {
    type: 'noul',
    instructions: {
      candidate: { title: candidate.title, artist: candidate.artist, album: candidate.album ?? '' },
      question: 'Is this song a strong match for the listener’s music request in the state?',
    },
    criteria: {
      true: 'The song fits the requested mood, genre, language, artist, or listening situation.',
      false: 'The song is unrelated, only shares a vague word, or conflicts with the request.',
    },
  }]));

  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ state: { listener_request: prompt }, model: 'jev-latest', questions }),
      signal: AbortSignal.timeout(6500),
    });
    if (!response.ok) return { tracks: candidates, ranked: false };
    const payload = record(await response.json().catch(() => null));
    const answers = record(payload.answers);
    const ranked = shortlist.map((candidate, index) => {
      const answer = record(answers[`track_${index}`]);
      const score = answer.type === 'noul' && typeof answer.noul === 'number' && Number.isFinite(answer.noul)
        ? Math.min(1, Math.max(0, answer.noul))
        : null;
      return { candidate, score, index };
    });
    if (ranked.every((item) => item.score === null)) return { tracks: candidates, ranked: false };
    ranked.sort((left, right) => (right.score ?? -1) - (left.score ?? -1) || left.index - right.index);
    return { tracks: [...ranked.map((item) => item.candidate), ...candidates.slice(shortlist.length)], ranked: true };
  } catch {
    return { tracks: candidates, ranked: false };
  }
}
