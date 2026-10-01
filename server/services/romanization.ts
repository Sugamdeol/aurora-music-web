import { createRomanizer, detectScript, type ScriptType } from 'lyric-romanizer';
import { resolveKuromojiDictDir } from 'lyric-romanizer/dict';
import { TaskQueue } from './taskQueue.js';
import Sanscript from '@indic-transliteration/sanscript';
import { transliterate } from 'transliteration';
import type { TimedLyric } from './lyrics.js';

export const LYRIC_LANGUAGES = ['auto', 'hindi', 'punjabi', 'marathi', 'gujarati', 'bengali', 'tamil', 'telugu', 'kannada', 'malayalam', 'odia', 'japanese', 'mandarin', 'cantonese', 'korean', 'thai', 'cyrillic', 'arabic', 'hebrew', 'other'] as const;
export type LyricLanguage = typeof LYRIC_LANGUAGES[number];
const scripts: Partial<Record<LyricLanguage, ScriptType>> = { hindi: 'devanagari', marathi: 'devanagari', punjabi: 'gurmukhi', gujarati: 'gujarati', bengali: 'bengali', tamil: 'tamil', telugu: 'telugu', kannada: 'kannada', malayalam: 'malayalam', odia: 'odia', japanese: 'japanese', mandarin: 'chinese', cantonese: 'chinese', korean: 'korean', thai: 'thai', cyrillic: 'cyrillic', arabic: 'arabic', hebrew: 'hebrew', other: 'other' };
const sanscript = Sanscript as unknown as { t: (text: string, from: string, to: string) => string };
const queue = new TaskQueue(1, 8);
const romanizer = createRomanizer({ japaneseDictPath: resolveKuromojiDictDir(), engines: { bengali: (line) => sanscript.t(line, 'bengali', 'iast'), malayalam: (line) => sanscript.t(line, 'malayalam', 'iast'), arabic: (line) => transliterate(line), hebrew: (line) => transliterate(line), other: (line) => transliterate(line) } });
const approximateScripts = new Set<ScriptType>(['arabic', 'hebrew', 'other']);
const indicScripts = new Set<ScriptType>(['devanagari', 'gurmukhi', 'gujarati', 'bengali', 'tamil', 'telugu', 'kannada', 'malayalam', 'odia']);

async function romanizeRows(rows: TimedLyric[], language: LyricLanguage = 'auto'): Promise<{ lines: TimedLyric[]; approximate: boolean }> {
  const dominant = detectScript(rows.map((line) => line.text));
  let approximate = false;
  const lines: TimedLyric[] = [];
  // Pin Japanese across kana + kanji lines; keep other mixed-script lines in their own language.
  for (const row of rows.slice(0, 500)) {
    const detected = detectScript([row.text]);
    if (detected === 'latin' || !/\p{L}/u.test(row.text)) { lines.push({ time: row.time, text: row.text }); continue; }
    const script = scripts[language] ?? (dominant === 'japanese' && detected === 'chinese' ? 'japanese' : detected);
    try {
      const result = await romanizer.romanizeLines([row.text], { script, dialect: language === 'cantonese' ? 'cantonese' : 'mandarin' });
      let text = result.lines[0] ?? row.text;
      const isApproximate = Boolean(result.fallbacks?.[0]) || approximateScripts.has(script);
      approximate ||= isApproximate;
      if (indicScripts.has(script) && text !== row.text) {
        // Remove the inherent final schwa before reducing IAST vowel marks.
        // Marathi and southern languages retain their final vowels.
        if (language === 'hindi' || language === 'punjabi' || (language === 'auto' && (script === 'devanagari' || script === 'gurmukhi'))) { const latin = new Set(row.text.match(/[A-Za-z]+/g) ?? []); text = text.replace(/([\p{L}]+)a\b/gu, (word, stem: string) => latin.has(word) ? word : /[bcdfghjklmnpqrstvwxyz]$/i.test(stem) ? stem : word); }
        text = text.replace(/[śṣ]/g, 'sh').replace(/[ŚṢ]/g, 'Sh').normalize('NFD').replace(/\p{M}/gu, '');
      }
      lines.push(text && text !== row.text ? { ...row, romanized: text } : { time: row.time, text: row.text });
    } catch { approximate = true; lines.push({ time: row.time, text: row.text }); }
  }
  return { lines, approximate };
}

export function romanizeLyrics(rows: TimedLyric[], language: LyricLanguage = 'auto'): Promise<{ lines: TimedLyric[]; approximate: boolean }> {
  return queue.run(() => romanizeRows(rows, language));
}
