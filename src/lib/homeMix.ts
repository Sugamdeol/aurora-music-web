import type { MediaTrack } from '../domain/media';

export function uniqueTracks(tracks: MediaTrack[]): MediaTrack[] {
  const seen = new Set<string>();
  return tracks.filter((track) => !seen.has(track.id) && Boolean(seen.add(track.id)));
}

/** Rotate familiar tracks daily, then weave in discoveries without repeating songs. */
export function dailyMix(familiar: MediaTrack[], discoveries: MediaTrack[], day: number): MediaTrack[] {
  const favorites = uniqueTracks(familiar);
  const offset = favorites.length ? ((day % favorites.length) + favorites.length) % favorites.length : 0;
  const rotated = [...favorites.slice(offset), ...favorites.slice(0, offset)];
  const known = new Set(favorites.map((track) => track.id));
  const fresh = uniqueTracks(discoveries).filter((track) => !known.has(track.id));
  const mix: MediaTrack[] = [];
  for (let index = 0; index < Math.max(rotated.length, Math.ceil(fresh.length / 2)); index += 1) {
    if (rotated[index]) mix.push(rotated[index]);
    mix.push(...fresh.slice(index * 2, index * 2 + 2));
  }
  return mix.slice(0, 20);
}
