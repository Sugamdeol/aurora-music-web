import type { EntityDetail, MediaEntity } from '../domain/media';
import { getSetting, setSetting } from './db';

export type SavedEntityKind = 'album' | 'artist';

function settingKey(kind: SavedEntityKind): string {
  return kind === 'artist' ? 'library.following.artists' : 'library.saved.albums';
}

export async function getSavedEntities(kind: SavedEntityKind): Promise<MediaEntity[]> {
  const values = await getSetting<MediaEntity[]>(settingKey(kind), []);
  return Array.isArray(values) ? values.filter((item) => item && item.kind === kind && Boolean(item.id && item.title)) : [];
}

export async function isEntitySaved(kind: SavedEntityKind, id: string): Promise<boolean> {
  return (await getSavedEntities(kind)).some((item) => item.id === id || item.browseId === id);
}

export async function setEntitySaved(detail: EntityDetail, saved: boolean): Promise<void> {
  if (detail.kind !== 'album' && detail.kind !== 'artist') return;
  const entities = await getSavedEntities(detail.kind);
  const retained = entities.filter((item) => item.id !== detail.id && item.browseId !== detail.id);
  if (saved) {
    retained.unshift({
      id: detail.id,
      browseId: detail.id,
      kind: detail.kind,
      title: detail.title,
      subtitle: detail.subtitle,
      artist: detail.artist,
      artistId: detail.artistId,
      artwork: detail.artwork,
      year: detail.year,
      count: detail.count,
    });
  }
  await setSetting(settingKey(detail.kind), retained.slice(0, 500));
}
