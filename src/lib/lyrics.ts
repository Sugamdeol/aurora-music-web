import type { LyricLine } from '../domain/media';
export const LYRIC_SOURCES = ['auto', 'YouLyPlus', 'Paxsenix', 'Unison', 'BetterLyrics', 'SimpMusic', 'LRCLIB', 'YouTube Music', 'custom'] as const;
export const LYRIC_LANGUAGES = [['auto','Detect language'],['hindi','Hindi'],['punjabi','Punjabi'],['marathi','Marathi'],['gujarati','Gujarati'],['bengali','Bengali / Assamese'],['tamil','Tamil'],['telugu','Telugu'],['kannada','Kannada'],['malayalam','Malayalam'],['odia','Odia'],['japanese','Japanese'],['mandarin','Chinese · Mandarin'],['cantonese','Chinese · Cantonese'],['korean','Korean'],['thai','Thai'],['cyrillic','Cyrillic'],['arabic','Arabic / Urdu'],['hebrew','Hebrew'],['other','Other scripts']] as const;
export interface LyricPreferences { source: string; language: string; customText: string; customRomanized: string; customLines: LyricLine[]; approximate?: boolean }
export const DEFAULT_LYRIC_PREFERENCES: LyricPreferences = { source: 'auto', language: 'auto', customText: '', customRomanized: '', customLines: [] };

export function parseCustomLyrics(text: string): LyricLine[] {
  if (new TextEncoder().encode(text).length > 40000) throw new Error('Keep lyrics below 40 KB.');
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (/^\[(?:ar|ti|al|by|offset|length):/i.test(raw.trim())) continue;
    const timestamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const value = raw.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim();
    if (!value) continue;
    if (value.length > 1000) throw new Error('Keep each lyric line below 1000 characters.');
    if (timestamps.length) for (const stamp of timestamps) {
      const seconds = Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] ?? '0'}`);
      if (Number(stamp[2]) >= 60 || seconds > 86400) throw new Error('Use valid LRC timestamps, like [01:23.45].');
      lines.push({ time: seconds, text: value });
    } else lines.push({ text: value });
  }
  if (lines.length > 500) throw new Error('Keep lyrics below 500 lines.');
  if (lines.some((line) => line.time !== undefined) && lines.some((line) => line.time === undefined)) throw new Error('Add a timestamp to every line, or use plain text for every line.');
  return lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

export function pairCustomRomanization(lines: LyricLine[], text: string): LyricLine[] {
  const romanized = parseCustomLyrics(text);
  if (lines.length !== romanized.length) throw new Error('Keep the same number of original and romanized lines.');
  return lines.map((line, i) => {
    const translation = romanized[i]!;
    if (translation.time !== undefined && translation.time !== line.time) throw new Error('Match the timestamps in both lyric versions.');
    return { ...line, romanized: translation.text === line.text ? undefined : translation.text };
  });
}
