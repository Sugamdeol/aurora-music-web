// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { estimateBpm, findBlendPoint } from '../server/services/audioAnalysis';

const RATE = 20;

function envelopeFromOnsets(onsets: number[], totalSeconds: number, noise = 0): number[] {
  const length = Math.round(totalSeconds * RATE);
  const energy = new Array(length).fill(noise);
  for (const onset of onsets) {
    const index = Math.round(onset * RATE);
    if (index >= 0 && index < length) energy[index] = 1;
  }
  return energy;
}

describe('server side audio analysis', () => {
  it('estimates a tempo from a steady pulse', () => {
    // 120 BPM means a beat every half second.
    const onsets: number[] = [];
    for (let t = 0; t < 30; t += 0.5) onsets.push(t);
    const energy = envelopeFromOnsets(onsets, 30);
    expect(estimateBpm(energy)).toBeCloseTo(120, 0);
  });

  it('estimates a different tempo for a different pulse', () => {
    const onsets: number[] = [];
    for (let t = 0; t < 40; t += 0.6) onsets.push(t);
    const energy = envelopeFromOnsets(onsets, 40);
    expect(estimateBpm(energy)).toBeCloseTo(100, 0);
  });

  it('reports no tempo for a flat signal', () => {
    const energy = new Array(600).fill(0.5);
    expect(estimateBpm(energy)).toBeUndefined();
  });

  it('reports no tempo for random noise', () => {
    const energy = Array.from({ length: 600 }, (_, i) => Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1));
    expect(estimateBpm(energy)).toBeUndefined();
  });

  it('finds the quiet break in the outro instead of the very end', () => {
    const length = 200 * RATE;
    const energy = new Array(length).fill(0.8);
    // A clear break 12 seconds before the end.
    for (let i = 0; i < 2 * RATE; i += 1) energy[length - 12 * RATE + i] = 0.05;
    const { blendStart } = findBlendPoint(energy, 200);
    expect(blendStart).toBeGreaterThan(180);
    expect(blendStart).toBeLessThan(196);
  });

  it('detects the final silence as the outro', () => {
    const length = 200 * RATE;
    const energy = new Array(length).fill(0.8);
    for (let i = 0; i < 6 * RATE; i += 1) energy[length - 6 * RATE + i] = 0;
    const { outroStart } = findBlendPoint(energy, 200);
    expect(outroStart).toBeGreaterThan(190);
    expect(outroStart).toBeLessThan(200);
  });

  it('keeps the blend inside the track', () => {
    const energy = new Array(200 * RATE).fill(0.8);
    const { blendStart } = findBlendPoint(energy, 200);
    expect(blendStart).toBeGreaterThanOrEqual(0);
    expect(blendStart).toBeLessThanOrEqual(198);
  });

  it('snaps the blend to a beat when the tempo is known', () => {
    const length = 200 * RATE;
    const energy = new Array(length).fill(0.8);
    for (let i = 0; i < RATE; i += 1) energy[190 * RATE + i] = 0.05;
    const { blendStart } = findBlendPoint(energy, 200, 120);
    // A 120 BPM beat is every 0.5 seconds.
    expect(Math.abs(blendStart / 0.5 - Math.round(blendStart / 0.5))).toBeLessThan(0.01);
  });
});
