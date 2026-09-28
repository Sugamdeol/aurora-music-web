import type { ExploreCategory, MusicHeader, MusicItem, MusicSection } from './types.js';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function valueAt(value: unknown, ...keys: string[]): unknown {
  let current = value;
  for (const key of keys) current = record(current)[key];
  return current;
}

export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return '';

  const item = record(value);
  if (typeof item.text === 'string') return item.text;
  if (Array.isArray(item.runs)) {
    return item.runs.map((run) => asText(record(run).text)).join('');
  }

  const toString = item.toString;
  if (typeof toString === 'function') {
    const text = String(toString.call(value));
    if (text !== '[object Object]') return text;
  }
  return '';
}

export function highResolutionThumbnail(value: unknown): string {
  const raw = typeof value === 'string' ? value : asText(record(value).url);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com')) {
      url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+)[^/]*$/, '=w1200-h1200-l90-rj');
    } else if (url.hostname === 'ytimg.com' || url.hostname.endsWith('.ytimg.com')) {
      url.pathname = url.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(jpg|webp)$/i, '/maxresdefault.$1');
    }
    return url.href;
  } catch {
    return raw;
  }
}

export function bestThumbnail(itemValue: unknown): string {
  const item = record(itemValue);
  const thumbnail = record(item.thumbnail);
  const rawCandidates = item.thumbnails ?? thumbnail.thumbnails ?? item.thumbnail ?? [];
  const candidates = Array.isArray(rawCandidates)
    ? rawCandidates
    : record(rawCandidates).url ? [rawCandidates] : [];

  let best: unknown;
  let bestArea = -1;
  for (const candidate of candidates) {
    const data = record(candidate);
    const area = Number(data.width ?? 0) * Number(data.height ?? 0);
    if (area >= bestArea) {
      best = candidate;
      bestArea = area;
    }
  }
  return highResolutionThumbnail(best);
}

function normalizeArtist(value: unknown): { name: string; id: string } {
  const artist = record(value);
  return {
    name: asText(artist.name),
    id: asText(artist.channel_id)
      || asText(valueAt(artist.endpoint, 'payload', 'browseEndpoint', 'browseId')),
  };
}

export function normalizeItem(itemValue: unknown, fallbackKind = 'song'): MusicItem {
  const item = record(itemValue);
  const payload = record(valueAt(item.endpoint, 'payload'));
  const browseId = asText(valueAt(payload, 'browseEndpoint', 'browseId'));
  const videoId = asText(valueAt(payload, 'watchEndpoint', 'videoId'));
  const ownId = asText(item.id);
  const artists = array(item.artists).map(normalizeArtist).filter((artist) => artist.name);
  const authors = array(item.authors).map(normalizeArtist).filter((artist) => artist.name);
  const subtitle = asText(item.subtitle);
  const author = asText(valueAt(item.author, 'name')) || authors.map(({ name }) => name).join(', ');
  const title = asText(item.title ?? item.name ?? item.button_text) || 'Untitled';
  const kind = asText(item.item_type) || fallbackKind;
  const album = record(item.album);

  return {
    id: videoId || ownId,
    browseId: browseId || (videoId ? '' : ownId),
    type: kind,
    title,
    artist: artists.map(({ name }) => name).join(', ') || author || subtitle.split(' • ')[0] || 'Unknown artist',
    artistId: artists[0]?.id || authors[0]?.id || '',
    artists: artists.length ? artists : authors,
    album: asText(album.name),
    albumId: asText(album.id),
    duration: asText(valueAt(item.duration, 'text')) || asText(item.duration),
    thumbnail: bestThumbnail(item),
    subtitle,
    year: asText(item.year),
    count: asText(item.song_count ?? item.item_count),
  };
}

export function normalizeHeader(headerValue: unknown): MusicHeader {
  const header = record(headerValue);
  return {
    title: asText(header.title ?? header.name) || 'Aurora Music',
    subtitle: asText(header.subtitle ?? header.second_subtitle),
    description: asText(header.description),
    thumbnail: bestThumbnail(header),
  };
}

export function normalizeSections(
  sectionsValue: unknown,
  fallbackTitle: string,
  fallbackKind = 'song',
): MusicSection[] {
  return array(sectionsValue).map((sectionValue) => {
    const section = record(sectionValue);
    const title = asText(valueAt(section.header, 'title') ?? section.title) || fallbackTitle;
    const items = array(section.contents)
      .map((item) => normalizeItem(item, asText(record(item).item_type) || fallbackKind))
      .filter((item) => item.id || item.browseId);
    return { title, items };
  }).filter((section) => section.items.length > 0);
}

export function normalizeSuggestions(value: unknown): string[] {
  const suggestions: string[] = [];
  for (const sectionValue of array(value)) {
    const section = record(sectionValue);
    for (const suggestionValue of array(section.contents)) {
      const suggestion = asText(record(suggestionValue).suggestion ?? suggestionValue).trim();
      if (suggestion && !suggestions.includes(suggestion)) suggestions.push(suggestion);
    }
  }
  return suggestions;
}

export function normalizeExploreCategories(value: unknown): ExploreCategory[] {
  return array(value).map((buttonValue) => {
    const button = record(buttonValue);
    // youtubei.js flattens browse endpoints to endpoint.payload.browseId; older
    // responses nested them one level deeper, so keep that as a fallback.
    return {
      title: asText(button.button_text ?? button.title),
      browseId: asText(valueAt(button.endpoint, 'payload', 'browseId') ?? valueAt(button.endpoint, 'payload', 'browseEndpoint', 'browseId')),
    };
  }).filter((category) => category.title && category.browseId);
}

export const cleanItem = normalizeItem;
export const cleanHeader = normalizeHeader;
