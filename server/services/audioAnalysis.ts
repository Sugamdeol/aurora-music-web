import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { cachedAudio } from './audioCache.js';

/**
 * Server-side audio analysis for Auto Mix.
 *
 * The browser can measure energy and tempo, but it only sees the part of
 * the track it has already played, it stops measuring when the tab is
 * backgrounded, and it cannot know where the song's real outro break is.
 * The server already holds the whole file in its audio cache, so it can
 * measure the complete track and tell the player exactly where the song
 * breathes before it ends. That is what makes the blend land musically
 * instead of on a fixed timer.
 */

export interface TrackAnalysis {
  /** Estimated tempo in beats per minute, when the pulse was clear. */
  bpm?: number;
  /** Where the blend should start, in seconds from the start of the track. */
  blendStart: number;
  /** Where the final outro (silence or tail) begins, in seconds. */
  outroStart?: number;
  /** Normalized energy envelope, one value per second. */
  energy: number[];
  /** Length of the analysed track in seconds. */
  duration: number;
}

const ANALYSIS_DIR = path.join(tmpdir(), 'aurora-audio-analysis');
const SAMPLE_RATE = 8000;
/** The envelope is kept at this many samples per second. */
const ENVELOPE_RATE = 20;
const MIN_TEMPO_BPM = 60;
const MAX_TEMPO_BPM = 200;
/** Only the tail of the track is searched for the blend point. */
const OUTRO_WINDOW_SECONDS = 45;
const CACHE_TTL_MS = 30 * 60_000;

const analysisCache = new Map<string, { value: TrackAnalysis; until: number }>();
const inFlight = new Map<string, Promise<TrackAnalysis | undefined>>();

function analysisPath(id: string): string {
  return path.join(ANALYSIS_DIR, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`);
}

interface Decoded {
  /** Raw mono samples in the range -1..1. */
  samples: Float32Array;
  sampleRate: number;
}

async function decodeAudio(file: string): Promise<Decoded | undefined> {
  return new Promise((resolve) => {
    const child = execFile('ffmpeg', [
      '-hide_banner', '-loglevel', 'error',
      '-i', file,
      '-f', 's16le', '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-',
    ], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error || !stdout?.length) { resolve(undefined); return; }
      const buffer = stdout as unknown as Buffer;
      const count = Math.floor(buffer.length / 2);
      const samples = new Float32Array(count);
      for (let i = 0; i < count; i += 1) samples[i] = buffer.readInt16LE(i * 2) / 32768;
      resolve({ samples, sampleRate: SAMPLE_RATE });
    });
  });
}

/** Builds a normalized energy envelope at ENVELOPE_RATE samples per second. */
function buildEnvelope(samples: Float32Array, sampleRate: number): { energy: number[]; duration: number } {
  const perBucket = Math.max(1, Math.floor(sampleRate / ENVELOPE_RATE));
  const count = Math.max(1, Math.floor(samples.length / perBucket));
  const energy: number[] = new Array(count).fill(0);
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
  return { energy, duration: samples.length / sampleRate };
}

/**
 * Estimates the tempo from the energy envelope.
 *
 * The envelope is differentiated first so that onsets, not sustained
 * loudness, drive the autocorrelation. A steady drone has no onsets and
 * therefore no tempo, which is correct: such a track has no pulse to
 * align a blend to.
 */
export function estimateBpm(energy: number[]): number | undefined {
  if (energy.length < 40) return undefined;
  const onset = new Float64Array(energy.length);
  for (let i = 1; i < energy.length; i += 1) onset[i] = Math.max(0, energy[i]! - energy[i - 1]!);

  let mean = 0;
  for (const value of onset) mean += value;
  mean /= onset.length;
  const centered = new Float64Array(onset.length);
  for (let i = 0; i < onset.length; i += 1) centered[i] = onset[i]! - mean;

  const minLag = Math.max(1, Math.floor((60 / MAX_TEMPO_BPM) * ENVELOPE_RATE));
  const maxLag = Math.min(centered.length - 1, Math.ceil((60 / MIN_TEMPO_BPM) * ENVELOPE_RATE));
  if (maxLag <= minLag) return undefined;

  let bestLag = 0;
  let bestScore = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = lag; i < centered.length; i += 1) sum += centered[i]! * centered[i - lag]!;
    const score = sum / (centered.length - lag);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (!bestLag || bestScore <= 0) return undefined;

  let variance = 0;
  for (const value of centered) variance += value * value;
  if (variance <= 0) return undefined;
  if (bestScore / (variance / centered.length) < 0.2) return undefined;

  const bpm = (60 * ENVELOPE_RATE) / bestLag;
  if (!Number.isFinite(bpm) || bpm < MIN_TEMPO_BPM || bpm > MAX_TEMPO_BPM) return undefined;
  return Math.round(bpm * 10) / 10;
}

/**
 * Finds where the song breathes before it ends.
 *
 * The blend starts at the quietest strong break in the outro, snapped to
 * the nearest beat when the tempo is known. When the track simply fades
 * out, the blend starts where the fade begins instead.
 */
export function findBlendPoint(energy: number[], duration: number, bpm?: number): { blendStart: number; outroStart?: number } {
  if (!energy.length || duration <= 0) return { blendStart: Math.max(0, duration - 8) };
  const windowStart = Math.max(0, Math.floor(duration - OUTRO_WINDOW_SECONDS));

  // The final silence: everything from here on is a tail that should not
  // be played at all.
  let outroStart: number | undefined;
  const silenceThreshold = 0.02;
  for (let i = energy.length - 1; i >= 0; i -= 1) {
    if (energy[i]! > silenceThreshold) break;
    outroStart = i;
  }
  if (outroStart !== undefined && outroStart / ENVELOPE_RATE < duration - 1) {
    outroStart = outroStart / ENVELOPE_RATE;
  } else outroStart = undefined;

  // A break is a stretch that is clearly quieter than the track around it.
  const average = energy.reduce((sum, value) => sum + value, 0) / energy.length;
  const breakThreshold = Math.max(0.08, average * 0.55);
  let best = windowStart;
  let bestLevel = Number.POSITIVE_INFINITY;
  for (let i = windowStart; i < energy.length; i += 1) {
    if (energy[i]! < breakThreshold && energy[i]! < bestLevel) {
      bestLevel = energy[i]!;
      best = i;
    }
  }
  let blendStart = best / ENVELOPE_RATE;

  if (bpm && bpm >= MIN_TEMPO_BPM && bpm <= MAX_TEMPO_BPM) {
    const beat = 60 / bpm;
    // Snap to the closest beat, but never move the blend later than the
    // break itself: a slightly early blend beats a late one.
    const snapped = Math.round(blendStart / beat) * beat;
    if (snapped <= duration - 0.5 && Math.abs(snapped - blendStart) < beat * 0.5) blendStart = snapped;
  }

  if (outroStart !== undefined) blendStart = Math.min(blendStart, outroStart);
  // Keep the blend inside the track and out of the very last moment.
  blendStart = Math.max(0, Math.min(duration - 2, blendStart));
  return { blendStart, outroStart };
}

async function analyzeFile(file: string, durationHint?: number): Promise<TrackAnalysis | undefined> {
  const decoded = await decodeAudio(file);
  if (!decoded || decoded.samples.length < SAMPLE_RATE) return undefined;
  const { energy, duration } = buildEnvelope(decoded.samples, decoded.sampleRate);
  const bpm = estimateBpm(energy);
  const { blendStart, outroStart } = findBlendPoint(energy, duration || durationHint || 0, bpm);
  return { bpm, blendStart, outroStart, energy, duration: duration || durationHint || 0 };
}

/**
 * Analyses a track, using the on-disk audio cache.
 * Returns undefined when the track is not cached yet or ffmpeg is missing.
 */
export async function analyzeTrack(id: string, durationHint?: number): Promise<TrackAnalysis | undefined> {
  const cached = analysisCache.get(id);
  if (cached && cached.until > Date.now()) return cached.value;
  const existing = inFlight.get(id);
  if (existing) return existing;

  const operation = (async (): Promise<TrackAnalysis | undefined> => {
    const file = await cachedAudio(id);
    if (!file) return undefined;

    // The result is written to disk so a server restart does not have to
    // decode the track again.
    try {
      const stored = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
      if (Number.isFinite(stored.duration)) {
        analysisCache.set(id, { value: stored, until: Date.now() + CACHE_TTL_MS });
        return stored;
      }
    } catch { /* Not analysed yet. */ }

    const analysis = await analyzeFile(file.file, durationHint);
    if (!analysis) return undefined;
    try {
      await mkdir(ANALYSIS_DIR, { recursive: true });
      await writeFile(analysisPath(id), JSON.stringify(analysis), 'utf8');
    } catch { /* The in-memory cache is enough. */ }
    analysisCache.set(id, { value: analysis, until: Date.now() + CACHE_TTL_MS });
    return analysis;
  })().finally(() => inFlight.delete(id));

  inFlight.set(id, operation);
  return operation;
}
