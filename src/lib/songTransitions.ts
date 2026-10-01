import type { MediaTrack, PlaybackSettings } from '../domain/media';

export function transitionDuration(settings: PlaybackSettings, current: MediaTrack, next: MediaTrack, duration: number): number {
  if (settings.transitionMode === 'off' || !Number.isFinite(duration) || duration <= 0) return 0;
  if (settings.transitionMode === 'automix' && current.album && current.album === next.album && current.artist === next.artist) return 0;
  const shorter = Math.min(duration, next.durationSeconds || duration);
  if (shorter < 15) return 0;
  const seconds = settings.transitionMode === 'automix' ? Math.max(3, Math.min(9, shorter * .025)) : Math.max(1, Math.min(12, settings.crossfadeSeconds || 6));
  return Math.min(seconds, shorter / 4);
}

export function mixGains(progress: number): [number, number] {
  const angle = Math.max(0, Math.min(1, progress)) * Math.PI / 2;
  return [Math.cos(angle), Math.sin(angle)];
}
