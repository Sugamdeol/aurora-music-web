export const EQ_FREQUENCIES = [60, 250, 1000, 4000, 12000];
export const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0],
  Bass: [6, 3, 0, -1, 1],
  Vocals: [-3, -1, 3, 4, 1],
  Warm: [3, 2, 0, -2, -3],
  Pop: [2, 1, -1, 2, 3],
};

export function safeEqualizerGains(value: unknown): number[] {
  const gains = Array.isArray(value) ? value : [];
  return EQ_FREQUENCIES.map((_, index) => typeof gains[index] === 'number' && Number.isFinite(gains[index]) ? Math.min(12, Math.max(-12, gains[index])) : 0);
}

export class EqualizerGraph {
  readonly filters: BiquadFilterNode[];
  readonly preamp: GainNode;
  constructor(private context: AudioContext) {
    this.filters = EQ_FREQUENCIES.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1;
      return filter;
    });
    this.preamp = context.createGain();
  }
  update(value: unknown): void {
    const gains = safeEqualizerGains(value);
    this.filters.forEach((filter, index) => filter.gain.setTargetAtTime(gains[index], this.context.currentTime, .03));
    // Leave headroom for boosted bands instead of clipping the audio output.
    this.preamp.gain.setTargetAtTime(10 ** (-Math.max(0, ...gains) / 20), this.context.currentTime, .03);
  }
  connect(source: AudioNode): AudioNode {
    this.filters.forEach((filter) => filter.disconnect());
    this.preamp.disconnect();
    let output = source;
    for (const filter of this.filters) { output.connect(filter); output = filter; }
    output.connect(this.preamp);
    return this.preamp;
  }
}
