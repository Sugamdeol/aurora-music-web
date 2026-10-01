export type SpatialMotion = 'orbit' | 'figure-eight' | 'sway' | 'manual';

export interface SpatialAudioSettings {
  enabled: boolean;
  motion: SpatialMotion;
  speed: number;
  depth: number;
  width: number;
  reverb: number;
  pan: number;
}

export interface SpatialPreset {
  id: string;
  name: string;
  note: string;
  settings: Omit<SpatialAudioSettings, 'enabled'>;
}

export const SPATIAL_AUDIO_STORAGE_KEY = 'aurora.spatial-audio.v1';
export const SPATIAL_PRESETS_STORAGE_KEY = 'aurora.spatial-presets.v1';

export const DEFAULT_SPATIAL_AUDIO: SpatialAudioSettings = {
  enabled: false,
  motion: 'orbit',
  speed: 0.08,
  depth: 82,
  width: 118,
  reverb: 14,
  pan: 0,
};

export const SPATIAL_PRESETS: SpatialPreset[] = [
  { id: 'slow-orbit', name: 'Slow orbit', note: 'A wide, unhurried sweep', settings: { motion: 'orbit', speed: 0.055, depth: 92, width: 122, reverb: 14, pan: 0 } },
  { id: 'figure-eight', name: 'Figure eight', note: 'A playful stereo loop', settings: { motion: 'figure-eight', speed: 0.09, depth: 84, width: 128, reverb: 19, pan: 0 } },
  { id: 'velvet-sway', name: 'Velvet sway', note: 'Soft movement, close room', settings: { motion: 'sway', speed: 0.045, depth: 57, width: 108, reverb: 8, pan: 0 } },
  { id: 'deep-space', name: 'Deep space', note: 'Long trails and open sides', settings: { motion: 'orbit', speed: 0.07, depth: 100, width: 142, reverb: 31, pan: 0 } },
];

const motions = new Set<SpatialMotion>(['orbit', 'figure-eight', 'sway', 'manual']);
const numberInRange = (value: unknown, fallback: number, min: number, max: number) => {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
};

export function normalizeSpatialAudioSettings(value: unknown): SpatialAudioSettings {
  const record = value && typeof value === 'object' ? value as Partial<SpatialAudioSettings> : {};
  return {
    enabled: Boolean(record.enabled),
    motion: motions.has(record.motion as SpatialMotion) ? record.motion as SpatialMotion : DEFAULT_SPATIAL_AUDIO.motion,
    speed: numberInRange(record.speed, DEFAULT_SPATIAL_AUDIO.speed, 0.03, 0.24),
    depth: numberInRange(record.depth, DEFAULT_SPATIAL_AUDIO.depth, 0, 100),
    width: numberInRange(record.width, DEFAULT_SPATIAL_AUDIO.width, 60, 150),
    reverb: numberInRange(record.reverb, DEFAULT_SPATIAL_AUDIO.reverb, 0, 45),
    pan: numberInRange(record.pan, 0, -100, 100),
  };
}

/** Coefficients for a headroom-safe mid/side width matrix. */
export function stereoWidthCoefficients(widthPercent: number, enabled = true): [number, number] {
  const width = enabled ? numberInRange(widthPercent, 100, 60, 150) / 100 : 1;
  const headroom = Math.min(1, 1 / width);
  return [((1 + width) / 2) * headroom, ((1 - width) / 2) * headroom];
}

export function spatialMotionAtPhase(settings: SpatialAudioSettings, phase: number): { pan: number; x: number; y: number } {
  const safePhase = Number.isFinite(phase) ? phase : 0;
  const figureEight = settings.motion === 'figure-eight';
  const sway = settings.motion === 'sway';
  const x = Math.sin(safePhase * (figureEight ? 2 : 1));
  const y = figureEight ? Math.sin(safePhase) * 0.42 : Math.cos(safePhase) * (sway ? 0.12 : 0.22);
  const depth = settings.enabled ? settings.depth / 100 * (sway ? 0.48 : 1) : 0;
  return { pan: x * depth, x, y };
}

export function readSpatialAudioSettings(): SpatialAudioSettings {
  try {
    const saved = localStorage.getItem(SPATIAL_AUDIO_STORAGE_KEY);
    return saved ? normalizeSpatialAudioSettings(JSON.parse(saved)) : DEFAULT_SPATIAL_AUDIO;
  } catch {
    return DEFAULT_SPATIAL_AUDIO;
  }
}

export function saveSpatialAudioSettings(settings: SpatialAudioSettings): void {
  try { localStorage.setItem(SPATIAL_AUDIO_STORAGE_KEY, JSON.stringify(settings)); } catch { /* Private browsing can block local storage. */ }
}

export function readCustomSpatialPresets(): SpatialPreset[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SPATIAL_PRESETS_STORAGE_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.slice(0, 8).flatMap((item: unknown, index: number) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Partial<SpatialPreset>;
      if (typeof record.name !== 'string' || !record.name.trim()) return [];
      const settings = normalizeSpatialAudioSettings({ ...(record.settings ?? {}), enabled: true });
      return [{ id: typeof record.id === 'string' ? record.id : `custom-${index}`, name: record.name.slice(0, 32), note: 'Your saved mix', settings: { motion: settings.motion, speed: settings.speed, depth: settings.depth, width: settings.width, reverb: settings.reverb, pan: settings.pan } }];
    });
  } catch {
    return [];
  }
}

export function saveCustomSpatialPresets(presets: SpatialPreset[]): void {
  try { localStorage.setItem(SPATIAL_PRESETS_STORAGE_KEY, JSON.stringify(presets.slice(0, 8))); } catch { /* Private browsing can block local storage. */ }
}
