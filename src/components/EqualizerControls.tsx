import { useState } from 'react';
import { EQ_FREQUENCIES, EQ_PRESETS, safeEqualizerGains } from '../lib/equalizer';
import { useLibraryStore } from '../store/library';

export function EqualizerControls() {
  const settings = useLibraryStore((state) => state.playbackSettings);
  const [error, setError] = useState('');
  const gains = safeEqualizerGains(settings.equalizerGains);
  const supported = typeof window.AudioContext !== 'undefined';
  const preset = Object.keys(EQ_PRESETS).find((name) => EQ_PRESETS[name].every((gain, index) => gain === gains[index])) ?? 'Custom';
  const update = (patch: Partial<typeof settings>) => { setError(''); void useLibraryStore.getState().updatePlaybackSettings(patch).catch(() => setError('Your sound settings could not be saved.')); };
  return <div className="equalizer-controls">
    <div className="eq-toolbar"><label><input type="checkbox" checked={settings.equalizerEnabled} disabled={!supported} onChange={(event) => update({ equalizerEnabled: event.target.checked })} /><span>Equalizer {settings.equalizerEnabled ? 'on' : 'off'}</span></label><select aria-label="Equalizer preset" value={preset} disabled={!supported} onChange={(event) => update({ equalizerEnabled: true, equalizerGains: EQ_PRESETS[event.target.value] })}>{Object.keys(EQ_PRESETS).map((name) => <option key={name}>{name}</option>)}{preset === 'Custom' && <option>Custom</option>}</select></div>
    <div className="eq-bands">{EQ_FREQUENCIES.map((frequency, index) => <label key={frequency}><span>{frequency >= 1000 ? `${frequency / 1000}k` : frequency} Hz</span><input type="range" min="-12" max="12" step="1" value={gains[index]} disabled={!supported || !settings.equalizerEnabled} aria-label={`${frequency} Hz gain`} onChange={(event) => { const next = [...gains]; next[index] = Number(event.target.value); update({ equalizerGains: next }); }} /><output>{gains[index] > 0 ? '+' : ''}{gains[index]} dB</output></label>)}</div>
    <div className="eq-foot"><p>{supported ? 'Shape bass, vocals, and treble. Boosted bands use extra headroom to avoid clipping.' : 'Audio effects are unavailable in this browser.'}</p><button className="text-button" disabled={!supported} onClick={() => update({ equalizerGains: [...EQ_PRESETS.Flat] })}>Reset</button></div>
    {error && <p className="danger" role="alert">{error}</p>}
  </div>;
}
