import type { MediaTrack, PlaybackSettings } from '../domain/media';

export interface TransitionPlan {
  /** Length of the blend, in seconds. */
  seconds: number;
  /** Position in the outgoing track where the blend should begin. */
  startAt: number;
}

export interface TrackProfile {
  /** Normalized energy samples (0..1) across the track, oldest first. */
  energy?: Float32Array;
  /** Estimated tempo in beats per minute, when it could be measured. */
  bpm?: number;
  /**
   * Where the blend should start, in seconds, as measured by the server.
   *
   * The server analyses the complete file, so it knows where the song
   * breathes before it ends even when the browser has not reached that
   * part yet. This is the primary source for the blend point.
   */
  blendStart?: number;
  /** Where the final outro or silence begins, in seconds. */
  outroStart?: number;
}

const MIN_BLEND_SECONDS = 3;
const MIN_TRACK_SECONDS = 15;
const SEARCH_WINDOW_SECONDS = 15;

/** A blend is longer when the two songs are short, and never eats a quarter of either. */
function blendLength(shorter: number, settings: PlaybackSettings): number {
  const base = settings.transitionMode === 'automix'
    ? Math.max(MIN_BLEND_SECONDS, Math.min(9, shorter * 0.025))
    : Math.max(1, Math.min(12, settings.crossfadeSeconds || 6));
  return Math.min(base, shorter / 4);
}

/** Beat length in seconds for a tempo, or undefined when the tempo is unknown. */
function beatSeconds(bpm?: number): number | undefined {
  if (!bpm || !Number.isFinite(bpm) || bpm < 40 || bpm > 220) return undefined;
  return 60 / bpm;
}

/**
 * Finds the quietest beat-aligned point inside the search window.
 * Landing the blend on a beat keeps the downbeat audible instead of
 * clipping it mid-hit, which is what separates a musical Auto Mix from a
 * plain crossfade.
 */
function chooseTransitionPoint(duration: number, profile: TrackProfile, settings: PlaybackSettings): number {
  const windowStart = Math.max(0, duration - SEARCH_WINDOW_SECONDS);
  const energy = profile.energy;
  const beat = beatSeconds(profile.bpm);

  // The server measured the whole track, so its blend point is the best
  // answer: it knows where the song actually breathes before the end.
  if (Number.isFinite(profile.blendStart) && profile.blendStart! > 0) {
    const measured = profile.blendStart!;
    if (measured < duration - 0.5) return measured;
  }

  if (!energy || energy.length < 4) {
    // Without an energy profile, land on the beat when the tempo is known.
    if (beat) {
      const beatsInWindow = Math.max(1, Math.floor(SEARCH_WINDOW_SECONDS / beat));
      return windowStart + (beatsInWindow - 1) * beat;
    }
    return Math.max(0, duration - blendLength(duration, settings));
  }

  const samplesPerSecond = energy.length / Math.max(1, duration);
  const candidate = (seconds: number): number => {
    const index = Math.min(energy.length - 1, Math.max(0, Math.round(seconds * samplesPerSecond)));
    return energy[index];
  };

  // Start from the quietest moment in the window, then refine to a beat.
  let quietest = windowStart;
  let quietestLevel = Number.POSITIVE_INFINITY;
  for (let time = windowStart; time < duration - 0.05; time += 0.25) {
    const level = candidate(time);
    if (level < quietestLevel) { quietestLevel = level; quietest = time; }
  }
  if (!beat) return quietest;

  let best = quietest;
  let bestScore = Number.POSITIVE_INFINITY;
  const step = beat / 2;
  for (let time = quietest - beat; time <= quietest + beat && time < duration - 0.05; time += step) {
    if (time < windowStart) continue;
    const level = candidate(time);
    const alignment = Math.abs((time / beat) - Math.round(time / beat));
    const score = level + alignment * 0.35;
    if (score < bestScore) { bestScore = score; best = time; }
  }
  return best;
}

/**
 * Plans how and where two songs should blend.
 * Returns null when the songs must play straight through.
 */
export function planTransition(
  settings: PlaybackSettings,
  current: MediaTrack,
  next: MediaTrack,
  duration: number,
  profile: TrackProfile = {},
): TransitionPlan | null {
  if (settings.transitionMode === 'off' || !Number.isFinite(duration) || duration <= 0) return null;
  if (settings.transitionMode === 'automix' && current.album && current.album === next.album && current.artist === next.artist) return null;
  const shorter = Math.min(duration, next.durationSeconds || duration);
  if (shorter < MIN_TRACK_SECONDS) return null;

  const seconds = blendLength(shorter, settings);
  const startAt = Math.max(0, Math.min(duration - seconds, chooseTransitionPoint(duration, profile, settings)));
  return { seconds: Math.min(seconds, Math.max(0.1, duration - startAt)), startAt };
}

export function transitionDuration(settings: PlaybackSettings, current: MediaTrack, next: MediaTrack, duration: number): number {
  return planTransition(settings, current, next, duration)?.seconds ?? 0;
}

export function mixGains(progress: number): [number, number] {
  const angle = Math.max(0, Math.min(1, progress)) * Math.PI / 2;
  return [Math.cos(angle), Math.sin(angle)];
}
