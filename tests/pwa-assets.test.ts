import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const publicDirectory = resolve(process.cwd(), 'public');
const readPublicFile = (name: string) => readFileSync(join(publicDirectory, name), 'utf8');

describe('web app manifest', () => {
  const manifest = JSON.parse(readPublicFile('manifest.webmanifest')) as {
    id: string;
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    theme_color: string;
    background_color: string;
    icons: Array<{ src: string; purpose: string; sizes: string; type: string }>;
    shortcuts: Array<{ name: string; url: string; icons?: Array<{ src: string }> }>;
  };

  it('contains install metadata and in-scope shortcuts', () => {
    expect(manifest).toMatchObject({
      id: '/',
      name: 'Aurora Music',
      short_name: 'Aurora',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#0b0d0b',
      background_color: '#0b0d0b',
    });
    expect(manifest.shortcuts).toHaveLength(3);
    expect(manifest.shortcuts.every(({ url }) => url.startsWith(manifest.scope))).toBe(true);
  });

  it('only references public assets that exist', () => {
    const referencedAssets = [
      ...manifest.icons.map(({ src }) => src),
      ...manifest.shortcuts.flatMap(({ icons = [] }) => icons.map(({ src }) => src)),
    ];

    for (const asset of referencedAssets) {
      expect(asset.startsWith('/')).toBe(true);
      expect(existsSync(join(publicDirectory, asset.slice(1))), asset).toBe(true);
    }

    expect(new Set(manifest.icons.map(({ purpose }) => purpose))).toEqual(new Set(['any', 'maskable']));
    // SVG stays the crisp default; sized PNGs keep install prompts and splash
    // screens working on platforms that ignore SVG icons.
    expect(manifest.icons.every(({ sizes, type }) =>
      (sizes === 'any' && type === 'image/svg+xml') || (type === 'image/png' && /^\d+x\d+$/.test(sizes ?? '')),
    )).toBe(true);
    expect(manifest.icons.some(({ sizes, type }) => type === 'image/png' && (sizes === '192x192' || sizes === '512x512'))).toBe(true);
  });
});

describe('Aurora icon', () => {
  it('faithfully represents every path in the Android vector drawable', () => {
    const document = new DOMParser().parseFromString(readPublicFile('aurora.svg'), 'image/svg+xml');
    const paths = [...document.querySelectorAll('path')];

    expect(document.documentElement.getAttribute('viewBox')).toBe('0 0 108 108');
    expect(paths).toHaveLength(6);
    expect(paths.map((path) => path.getAttribute('d'))).toEqual([
      'M54,4 C82,4 104,26 104,54 C104,82 82,104 54,104 C26,104 4,82 4,54 C4,26 26,4 54,4 Z',
      'M54,10 C78.3,10 98,29.7 98,54 C98,78.3 78.3,98 54,98 C29.7,98 10,78.3 10,54 C10,29.7 29.7,10 54,10 Z',
      'M29,78 C39,63 48,44 55,25 C62,44 71,63 81,78',
      'M39,62 C47,59 55,58 63,60 C67,61 71,63 75,65',
      'M39,76 L48,76 L54,68 L60,83 L67,72 L76,72',
      'M55,24 m-3.2,0 a3.2,3.2 0 1,0 6.4,0 a3.2,3.2 0 1,0 -6.4,0',
    ]);
    expect(paths.map((path) => path.getAttribute('fill'))).toEqual([
      '#0b0d0b',
      '#121712',
      'none',
      'none',
      'none',
      '#8aff18',
    ]);
    expect(paths.slice(2, 5).map((path) => path.getAttribute('stroke'))).toEqual([
      '#8aff18',
      '#c9ff7a',
      '#eaffc4',
    ]);
    expect(paths.slice(2, 5).map((path) => path.getAttribute('stroke-width'))).toEqual(['5.5', '4', '3.4']);
    expect(paths.slice(2, 5).every((path) => path.getAttribute('stroke-linecap') === 'round')).toBe(true);
    expect(paths.slice(2, 5).every((path) => path.getAttribute('stroke-linejoin') === 'round')).toBe(true);
  });
});
