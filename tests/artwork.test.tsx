import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bestThumbnail, normalizeHeader, normalizeItem } from '../server/normalizers';
import { normalizeMedia } from '../src/lib/api';
import { Artwork } from '../src/components/primitives';

const cover = 'https://lh3.googleusercontent.com/album-cover=w544-h544-l90-rj';
describe('catalog artwork', () => {
  it('reads MusicThumbnail contents for album cards and responsive detail headers', () => {
    const thumbnail = { type: 'MusicThumbnail', contents: [{ url: cover, width: 544, height: 544 }] };
    expect(normalizeItem({ id: 'album', title: 'Album', thumbnail }, 'album').thumbnail).toContain('/album-cover=');
    expect(normalizeHeader({ title: 'Album', thumbnail }).thumbnail).toContain('/album-cover=');
    expect(normalizeHeader({ header: { title: 'Playlist', thumbnail } }).thumbnail).toContain('/album-cover=');
  });
  it('chooses the largest supplied thumbnail and preserves available YouTube tiers', () => {
    const url = 'https://i.ytimg.com/vi/song/hqdefault.jpg';
    expect(bestThumbnail({ thumbnails: [{ url: 'https://example.com/small.jpg', width: 100, height: 100 }, { url, width: 480, height: 360 }] })).toBe(url);
    expect(bestThumbnail({ thumbnail: url })).toBe(url);
  });
  it('uses the actual song thumbnail when playlist rows omit artwork', () => {
    expect(normalizeMedia({ id: 'dQw4w9WgXcQ', title: 'Song', kind: 'song' })?.artwork).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(normalizeMedia({ id: 'local-file', title: 'File', kind: 'local' })?.artwork).toBe('');
  });
  it('recovers old saved maxres URLs using the same song’s available cover', () => {
    render(<Artwork src="https://i.ytimg.com/vi/song/maxresdefault.jpg" alt="Album cover" />);
    const img = screen.getByAltText('Album cover');
    fireEvent.error(img);
    expect(img).toHaveAttribute('src', 'https://i.ytimg.com/vi/song/hqdefault.jpg');
    expect(img).not.toHaveAttribute('srcset');
  });
});
