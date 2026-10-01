import { describe, expect, it } from 'vitest';
import { DEFAULT_SPATIAL_AUDIO, normalizeSpatialAudioSettings, spatialMotionAtPhase, stereoWidthCoefficients } from '../src/lib/spatialAudio';

describe('spatial audio settings', () => {
  it('falls back to safe defaults for invalid saved values', () => {
    expect(normalizeSpatialAudioSettings(null)).toEqual(DEFAULT_SPATIAL_AUDIO);
    expect(normalizeSpatialAudioSettings({ enabled: true, motion: 'teleport', speed: 0, width: 500, reverb: -3, pan: -500 })).toEqual({
      ...DEFAULT_SPATIAL_AUDIO,
      enabled: true,
      speed: 0.03,
      width: 150,
      reverb: 0,
      pan: -100,
    });
  });

  it('keeps the untouched stereo signal neutral at 100 percent width', () => {
    expect(stereoWidthCoefficients(100)).toEqual([1, 0]);
  });

  it('narrows the side signal cleanly and protects headroom when widened', () => {
    const [narrowDirect, narrowCross] = stereoWidthCoefficients(60);
    expect(narrowDirect).toBeCloseTo(0.8);
    expect(narrowCross).toBeCloseTo(0.2);

    const [wideDirect, wideCross] = stereoWidthCoefficients(150);
    expect(wideDirect).toBeCloseTo(5 / 6);
    expect(wideCross).toBeCloseTo(-1 / 6);
    expect(wideDirect - wideCross).toBeCloseTo(1);
  });

  it('bypasses width changes when the spatial effect is switched off', () => {
    expect(stereoWidthCoefficients(150, false)).toEqual([1, 0]);
  });

  it('gives orbit, figure-eight, and sway distinct movement', () => {
    const base = { ...DEFAULT_SPATIAL_AUDIO, enabled: true, depth: 100 };
    const orbit = spatialMotionAtPhase({ ...base, motion: 'orbit' }, Math.PI / 4);
    const figureEight = spatialMotionAtPhase({ ...base, motion: 'figure-eight' }, Math.PI / 4);
    const sway = spatialMotionAtPhase({ ...base, motion: 'sway' }, Math.PI / 2);

    expect(orbit.pan).toBeCloseTo(Math.SQRT1_2);
    expect(figureEight.pan).toBeCloseTo(1);
    expect(figureEight.y).not.toBe(0);
    expect(sway.pan).toBeCloseTo(0.48);
  });
});
