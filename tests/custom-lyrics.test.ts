import { expect, it } from 'vitest';
import { parseCustomLyrics, pairCustomRomanization } from '../src/lib/lyrics';
it('reads LRC including repeated timestamps and sorts the lines', () => {
  expect(parseCustomLyrics('[ar:Me]\n[00:30.50] Second\n[00:02.00][00:12.00] First')).toEqual([{ time: 2, text: 'First' }, { time: 12, text: 'First' }, { time: 30.5, text: 'Second' }]);
});
it('keeps plain lyrics plain and pairs custom romanized text without inventing timing', () => {
  const lines = parseCustomLyrics('दिल\nमेरा');
  expect(pairCustomRomanization(lines, 'dil\nmera')).toEqual([{ text: 'दिल', romanized: 'dil' }, { text: 'मेरा', romanized: 'mera' }]);
});
it('rejects invalid or inconsistent timing and mismatched romanized lines', () => {
  expect(() => parseCustomLyrics('[00:70.00] Bad')).toThrow();
  expect(() => parseCustomLyrics('[00:01.00] First\nNo timestamp')).toThrow();
  expect(() => pairCustomRomanization([{ text: 'First', time: 1 }], '[00:02.00] One')).toThrow();
  expect(() => pairCustomRomanization([{ text: 'First' }], 'One\nTwo')).toThrow();
});
