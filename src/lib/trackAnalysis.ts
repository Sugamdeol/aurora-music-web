/**
 * Lightweight audio analysis used by Auto Mix.
 *
 * The browser can measure a track's energy and tempo from decoded audio
 * without any model or network call. These helpers turn that signal into
 * the two numbers a musical transition needs: where the song breathes
 * (a quiet point) and how fast its pulse is (a tempo).
 */

export interface EnergyProfile {
  /** Normalized energy samples (0..1), oldest first. */
  energy: Float32Array;
  /** Samples per second of the energy envelope. */
  sampleRate: number;
  /** Length of the analysed audio in seconds. */
  durationSeconds: number;
  /** Estimated tempo in beats per minute, when the pulse was clear. */
  bpm?: number;
}

const MIN_TEMPO_BPM = 60;
const MAX_TEMPO_BPM = 200;

/**
 * Estimates a tempo by autocorrelating the energy envelope and picking
 * the strongest peak that sits in a plausible BPM range.
 * Returns undefined when the signal has no clear pulse.
 */
export function estimateTempo(energy: Float32Array, sampleRate: number): number | undefined {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return undefined;
  if (energy.length < sampleRate * 2) return undefined;

  // Remove the slow trend so a fade-out is not read as a slow tempo.
  const centered = new Float32Array(energy.length);
  let mean = 0;
  for (let i = 0; i < energy.length; i += 1) mean += energy[i];
  mean /= energy.length;
  for (let i = 0; i < energy.length; i += 1) centered[i] = energy[i] - mean;

  const minLag = Math.max(1, Math.floor((60 / MAX_TEMPO_BPM) * sampleRate));
  const maxLag = Math.min(centered.length - 1, Math.ceil((60 / MIN_TEMPO_BPM) * sampleRate));
  if (maxLag <= minLag) return undefined;

  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = lag; i < centered.length; i += 1) sum += centered[i] * centered[i - lag];
    const score = sum / (centered.length - lag);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore <= 0) return undefined;

  const bpm = (60 * sampleRate) / bestLag;
  if (!Number.isFinite(bpm) || bpm < MIN_TEMPO_BPM || bpm > MAX_TEMPO_BPM) return undefined;
  // Reject a signal whose pulse is not actually periodic: the peak
  // autocorrelation must be a clear fraction of the total variance.
  let variance = 0;
  for (let i = 0; i < centered.length; i += 1) variance += centered[i] * centered[i];
  if (variance <= 0) return undefined;
  if (bestScore / (variance / centered.length) < 0.25) return undefined;
  return Math.round(bpm * 10) / 10;
}

/**
 * Finds the quietest moment inside a search window near the end of a
 * track, so a blend can start where the music is not mid-hit.
 */
export function findQuietPoint(profile: EnergyProfile, windowStart: number, windowEnd: number): number | undefined {
  const { energy, sampleRate, durationSeconds } = profile;
  if (!energy?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return undefined;
  const start = Math.max(0, windowStart);
  const end = Math.min(durationSeconds || windowEnd, windowEnd);
  if (end <= start) return undefined;

  const firstIndex = Math.min(energy.length - 1, Math.max(0, Math.round(start * sampleRate)));
  const lastIndex = Math.min(energy.length - 1, Math.max(firstIndex, Math.round(end * sampleRate)));
  if (lastIndex <= firstIndex) return undefined;

  let quietest = firstIndex;
  let quietestLevel = Number.POSITIVE_INFINITY;
  for (let i = firstIndex; i <= lastIndex; i += 1) {
    if (energy[i] < quietestLevel) { quietestLevel = energy[i]; quietest = i; }
  }
  return quietest / sampleRate;
}

/**
 * Builds an energy envelope from raw time-domain samples.
 * Kept separate from the analysis so the source of the samples
 * (decoded audio, an analyser node) stays a caller decision.
 */
export function energyEnvelope(samples: Float32Array, sampleRate: number, buckets = 600): EnergyProfile {
  const count = Math.max(1, Math.min(buckets, Math.floor(samples.length / 2)));
  const perBucket = Math.max(1, Math.floor(samples.length / count));
  const energy = new Float32Array(count);
  let peak = 0;
  for (let b = 0; b < count; b += 1) {
    let sum = 0;
    const from = b * perBucket;
    const to = Math.min(samples.length, from + perBucket);
    for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    energy[b] = rms;
    if (rms > peak) peak = rms;
  }
  if (peak > 0) for (let b = 0; b < count; b += 1) energy[b] /= peak;
  return { energy, sampleRate: count / Math.max(0.001, samples.length / sampleRate), durationSeconds: samples.length / sampleRate };
}
