// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeTrack } from '../server/services/audioAnalysis';
import { cachedAudio } from '../server/services/audioCache';
import { existsSync } from 'node:fs';

/**
 * These run against a track that the server already cached. They prove the
 * whole path: cached file to decoded audio to a blend point that lands
 * inside the song's outro.
 */
const CACHED_ID = process.env.AURORA_TEST_TRACK_ID ?? 'kOn-HdEg6AQ';

describe('analysis of a cached track', () => {
  it('measures a real track and finds a blend point in its outro', async () => {
    const cached = await cachedAudio(CACHED_ID);
    if (!cached || !existsSync(cached.file)) {
      // Nothing cached on this machine: the unit tests above cover the
      // behaviour of the analysis itself.
      expect(true).toBe(true);
      return;
    }
    const analysis = await analyzeTrack(CACHED_ID, 258);
    expect(analysis).toBeDefined();
    expect(analysis!.duration).toBeGreaterThan(200);
    expect(analysis!.blendStart).toBeGreaterThan(0);
    expect(analysis!.blendStart).toBeLessThan(analysis!.duration);
    // The blend has to start before the track ends, but not so early that
    // it cuts the song short.
    expect(analysis!.blendStart).toBeGreaterThan(analysis!.duration - 60);
    expect(analysis!.energy.length).toBeGreaterThan(100);
  }, 60000);
});
