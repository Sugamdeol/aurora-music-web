import type { MediaTrack } from '../domain/media';

export type TrackSort = 'saved' | 'title' | 'artist' | 'duration';

export function filterTracks(tracks: MediaTrack[], query: string, sort: TrackSort): MediaTrack[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const result = tracks.filter((track) => {
    const text = `${track.title} ${track.artist} ${track.album ?? ''}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  if (sort === 'title') result.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'artist') result.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  if (sort === 'duration') result.sort((a, b) => (a.durationSeconds ?? Infinity) - (b.durationSeconds ?? Infinity));
  return result;
}

export function shuffledTracks(tracks: MediaTrack[]): MediaTrack[] {
  const result = [...tracks];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
