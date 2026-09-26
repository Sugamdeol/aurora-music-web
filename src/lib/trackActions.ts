import type { MediaTrack } from '../domain/media';
import { api } from './api';
import { uniqueTracks } from './homeMix';
import { usePlaybackStore } from '../store/playback';

let radioRequest = 0;
export async function startTrackRadio(track: MediaTrack): Promise<boolean> {
  if (track.source === 'local') throw new Error('Song radio needs an online track.');
  const request = ++radioRequest;
  const revision = usePlaybackStore.getState().sourceRevision;
  const related = uniqueTracks(await api.related(track.id)).filter((item) => item.id !== track.id && item.source !== 'local');
  if (request !== radioRequest || usePlaybackStore.getState().sourceRevision !== revision) return false;
  if (!related.length) throw new Error('No radio suggestions found for this song. Try another track.');
  usePlaybackStore.getState().playTracks([track, ...related.slice(0, 30)], 0, `${track.title} radio`);
  return true;
}

export function songShareUrl(track: MediaTrack): string {
  const url = new URL('https://music.youtube.com/watch');
  url.searchParams.set('v', track.id);
  return url.toString();
}

export function lyricIndexAt(times: Array<number | undefined>, position: number, offsetMs: number): number {
  const effective = position - offsetMs / 1000;
  return times.reduce<number>((active, time, index) => time !== undefined && time <= effective ? index : active, -1);
}
