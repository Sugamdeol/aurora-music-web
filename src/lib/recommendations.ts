import type { MediaTrack } from '../domain/media';
import type { HistoryRecord } from './db';

export interface TasteProfile {
  artists: Record<string, number>;
  tracks: Record<string, number>;
  recent: Set<string>;
}
export interface RecommendationFeedback { hidden: string[]; skips: Record<string, number>; }
const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const artistsOf = (track: MediaTrack) => (track.artists?.length ? track.artists.map((artist) => artist.name) : [track.artist]).map(normalize).filter((name) => name && name !== 'unknown artist');
// Alternate uploads of the same recording should not fill a recommendation shelf.
export const recordingKey = (track: MediaTrack) => `${normalize(track.title.replace(/\([^)]*(?:official|lyrics|lyric|audio|video)[^)]*\)|\[[^\]]*(?:official|lyrics|lyric|audio|video)[^\]]*\]/gi, ''))}:${normalize(track.artist)}`;

export function buildTasteProfile(favorites: MediaTrack[], history: HistoryRecord[], now = Date.now()): TasteProfile {
  const profile: TasteProfile = { artists: {}, tracks: {}, recent: new Set() };
  const add = (id: string, artist: string, weight: number) => {
    profile.tracks[id] = (profile.tracks[id] ?? 0) + weight;
    const key = normalize(artist);
    if (key && key !== 'unknown artist') profile.artists[key] = (profile.artists[key] ?? 0) + weight;
  };
  for (const track of favorites) add(track.id, track.artist, 4);
  for (const play of history) {
    const age = Math.max(0, now - play.playedAt);
    // Legacy history without listen time is weak evidence, not a completed play.
    const engagement = play.listenedSeconds === undefined ? .15 : Math.min(1, Math.max(0, play.listenedSeconds) / 90);
    add(play.trackId, play.artist ?? '', engagement * Math.exp(-age / (21 * 86_400_000)));
    if (age < 24 * 60 * 60_000) profile.recent.add(play.trackId);
  }
  return profile;
}

export function rankRecommendations(candidates: MediaTrack[], profile: TasteProfile, feedback: RecommendationFeedback, options: { limit?: number; exclude?: MediaTrack[]; day?: number } = {}): MediaTrack[] {
  const seenIds = new Set(options.exclude?.map((track) => track.id));
  const seenRecordings = new Set(options.exclude?.map(recordingKey));
  const hidden = new Set(feedback.hidden);
  const maxAffinity = Math.max(1, ...Object.values(profile.artists));
  const hash = (value: string) => [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, options.day ?? 0);
  const pool = candidates.filter((track) => {
    const key = recordingKey(track);
    if (track.source !== 'remote' || hidden.has(track.id) || seenIds.has(track.id) || seenRecordings.has(key)) return false;
    seenIds.add(track.id); seenRecordings.add(key); return true;
  }).map((track, index) => ({ track, artists: artistsOf(track), score:
    2 * Math.max(0, ...artistsOf(track).map((artist) => (profile.artists[artist] ?? 0) / maxAffinity))
    + 1 / (1 + index / 10) + (profile.tracks[track.id] ? .3 : .7)
    - (profile.recent.has(track.id) ? 2 : 0) - Math.min(4, feedback.skips[track.id] ?? 0)
    + (hash(track.id) % 100) / 1000 }));
  const selected: MediaTrack[] = [];
  const counts = new Map<string, number>();
  let previous: string[] = [];
  while (pool.length && selected.length < (options.limit ?? 20)) {
    // Re-score after each choice so one favourite artist cannot dominate.
    pool.sort((a, b) => {
      const score = (item: typeof a) => item.score - Math.max(0, ...item.artists.map((artist) => (counts.get(artist) ?? 0) * .9 + (previous.includes(artist) ? 1.5 : 0)));
      return score(b) - score(a) || a.track.id.localeCompare(b.track.id);
    });
    const next = pool.shift()!;
    selected.push(next.track); previous = next.artists;
    next.artists.forEach((artist) => counts.set(artist, (counts.get(artist) ?? 0) + 1));
  }
  return selected;
}

export function recommendationSeeds(tracks: MediaTrack[], profile: TasteProfile, feedback: RecommendationFeedback, limit = 5): MediaTrack[] {
  return rankRecommendations(tracks, profile, feedback, { limit });
}
