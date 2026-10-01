import { useEffect } from 'react';
import { playbackEngine } from '../lib/playbackEngine';

export function usePlaybackEngine(): void {
  useEffect(() => playbackEngine.start(), []);
}
