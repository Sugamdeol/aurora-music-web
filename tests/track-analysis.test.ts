import { describe, expect, it } from 'vitest';
import { estimateTempo, findQuietPoint, type EnergyProfile } from '../src/lib/trackAnalysis';

function pulseEnvelope(bpm: number, seconds: number, sampleRate = 50): Float32Array {
  const count = Math.round(seconds * sampleRate);
  const out = new Float32Array(count);
  const beat = 60 / bpm;
  for (let i = 0; i < count; i += 1) {
    const time = i / sampleRate;
    const phase = (time % beat) / beat;
    out[i] = Math.exp(-phase * 9);
  }
  return out;
}

describe('track analysis', () => {
  it('estimates a tempo from a pulsing energy envelope', () => {
    const energy = pulseEnvelope(120, 12);
    const bpm = estimateTempo(energy, 50);
    expect(bpm).toBeGreaterThan(110);
    expect(bpm).toBeLessThan(130);
  });

  it('returns no tempo for silence or noise without a pulse', () => {
    expect(estimateTempo(new Float32Array(200), 50)).toBeUndefined();
    const noise = new Float32Array(400);
    for (let i = 0; i < noise.length; i += 1) noise[i] = Math.random();
    expect(estimateTempo(noise, 50)).toBeUndefined();
  });

  it('finds the quietest point inside the search window', () => {
    const profile: EnergyProfile = { energy: new Float32Array([0.9, 0.9, 0.9, 0.05, 0.9, 0.9]), sampleRate: 1, durationSeconds: 6 };
    const point = findQuietPoint(profile, 3, 6);
    expect(point).not.toBeNull();
    expect(point!).toBeGreaterThanOrEqual(3);
    expect(point!).toBeLessThan(6);
  });

  it('keeps consecutive album tracks gapless', () => {
    const profile: EnergyProfile = { energy: new Float32Array([0.2, 0.9, 0.2, 0.9]), sampleRate: 1, durationSeconds: 4 };
    expect(findQuietPoint(profile, 2, 4)).not.toBeNull();
  });
});
