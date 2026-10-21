// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseRangeHeader, resolveRange } from '../server/services/audioCache';

describe('audio cache range handling', () => {
  it('parses a byte range request', () => {
    expect(parseRangeHeader('bytes=0-1023')).toEqual({ start: 0, end: 1023 });
    expect(parseRangeHeader('bytes=100-')).toEqual({ start: 100, end: undefined });
    expect(parseRangeHeader('bytes=-500')).toEqual({ start: undefined, end: 500 });
  });

  it('rejects malformed range headers', () => {
    expect(parseRangeHeader('items=0-10')).toBeNull();
    expect(parseRangeHeader('bytes=abc')).toBeNull();
    expect(parseRangeHeader('bytes=10-5')).toBeNull();
    expect(parseRangeHeader('')).toBeNull();
  });

  it('resolves a range against a known file size', () => {
    expect(resolveRange({ start: 0, end: 1023 }, 5000)).toEqual({ start: 0, end: 1023, length: 1024, partial: true });
    expect(resolveRange({ start: 100, end: undefined }, 5000)).toEqual({ start: 100, end: 4999, length: 4900, partial: true });
    expect(resolveRange({ start: undefined, end: 500 }, 5000)).toEqual({ start: 4500, end: 4999, length: 500, partial: true });
  });

  it('reports an unsatisfiable range when the offset is past the end', () => {
    expect(resolveRange({ start: 9000, end: undefined }, 5000)).toBeNull();
  });

  it('serves the whole file when no range is requested', () => {
    expect(resolveRange(null, 5000)).toEqual({ start: 0, end: 4999, length: 5000, partial: false });
  });
});
