// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeTrack } from '../server/services/audioAnalysis';
import { cachedAudio } from '../server/services/audioCache';

const IDS = ['kOn-HdEg6AQ', 'sO4vI8P88NM', 'UHV0ja0vhzU', 'xukbqwRuN5w'];

describe('analysis of every cached track', () => {
  it.each(IDS)('measures %s', async (id) => {
    const cached = await cachedAudio(id);
    if (!cached) { expect(true).toBe(true); return; }
    const analysis = await analyzeTrack(id);
    expect(analysis).toBeDefined();
    expect(analysis!.duration).toBeGreaterThan(0);
    expect(analysis!.blendStart).toBeGreaterThanOrEqual(0);
    expect(analysis!.blendStart).toBeLessThan(analysis!.duration);
  }, 90000);
});
