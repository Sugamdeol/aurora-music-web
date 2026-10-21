import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYBACK_SETTINGS, type MediaTrack } from '../src/domain/media';
import { planTransition } from '../src/lib/songTransitions';

const tracks: MediaTrack[] = ['one', 'two'].map((id) => ({ id, title: id, artist: 'Artist', kind: 'song', source: 'remote', durationSeconds: 200 }));

describe('Auto Mix planning', () => {
  it('picks a musical transition point near the end of the track', () => {
    const plan = planTransition({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' }, tracks[0], tracks[1], 200, { energy: new Float32Array([0.2, 0.8, 0.9, 0.15, 0.85, 0.1, 0.9, 0.1]) });
    expect(plan).not.toBeNull();
    expect(plan!.seconds).toBeGreaterThan(0);
    // The fade must start inside the final 15 seconds of the track.
    expect(plan!.startAt).toBeGreaterThanOrEqual(200 - 15);
    expect(plan!.startAt).toBeLessThan(200);
  });

  it('keeps consecutive album tracks gapless', () => {
    const plan = planTransition(
      { ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' },
      { ...tracks[0], album: 'One album' },
      { ...tracks[1], album: 'One album' },
      200,
      { energy: new Float32Array([0.2, 0.8, 0.9, 0.15, 0.85, 0.1, 0.9, 0.1]) },
    );
    expect(plan).toBeNull();
  });

  it('falls back to a fixed blend when no energy profile is available', () => {
    const plan = planTransition({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' }, tracks[0], tracks[1], 200);
    expect(plan).not.toBeNull();
    expect(plan!.seconds).toBeGreaterThan(0);
    expect(plan!.startAt).toBeGreaterThan(200 - 15);
  });

  it('never plans a fade longer than a quarter of the shorter track', () => {
    const plan = planTransition({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' }, tracks[0], { ...tracks[1], durationSeconds: 40 }, 200);
    expect(plan!.seconds).toBeLessThanOrEqual(10);
  });

  it('returns no plan for short clips, off mode, and repeat-one queues', () => {
    expect(planTransition({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'automix' }, tracks[0], tracks[1], 8)).toBeNull();
    expect(planTransition({ ...DEFAULT_PLAYBACK_SETTINGS, transitionMode: 'off' }, tracks[0], tracks[1], 200)).toBeNull();
  });
});
