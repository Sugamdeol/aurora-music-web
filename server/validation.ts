import { z } from 'zod';
import { validationError } from './errors.js';

function requiredText(maximum: number, message: string): z.ZodString {
  return z.string({ error: message }).trim().min(1, { error: message }).max(maximum, { error: message });
}

const searchPrompt = 'Type a song, artist, album, or playlist to search.';

const searchTypeSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.toLowerCase() : value,
  z.enum(
    ['song', 'video', 'artist', 'album', 'playlist'],
    { error: 'Choose songs, videos, artists, albums, or playlists.' },
  ).default('song'),
);

export const searchQuerySchema = z.object({
  q: requiredText(120, searchPrompt),
  type: searchTypeSchema,
});

export const suggestionsQuerySchema = z.object({
  q: requiredText(120, searchPrompt),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export const trackParamsSchema = z.object({
  id: z.string({ error: 'Invalid track.' }).regex(/^[A-Za-z0-9_-]{6,20}$/, 'Invalid track.'),
});

export const artistParamsSchema = z.object({
  id: z.string({ error: 'Invalid artist.' })
    .regex(/^(?:UC|FEmusic_library_privately_owned_artist)[A-Za-z0-9_-]{5,100}$/, 'Invalid artist.'),
});

export const albumParamsSchema = z.object({
  id: z.string({ error: 'Invalid album.' })
    .regex(/^(?:MPRE|FEmusic_library_privately_owned_release)[A-Za-z0-9_-]{5,100}$/, 'Invalid album.'),
});

export const playlistParamsSchema = z.object({
  id: z.string({ error: 'Invalid playlist.' })
    .regex(/^(?:VL|PL|RD|VLRD)[A-Za-z0-9_-]{5,120}$/, 'Invalid playlist.'),
});

export const rangeHeaderSchema = z.string()
  .regex(/^bytes=(?:\d+-\d*|-\d+)(?:,(?:\d+-\d*|-\d+))*$/i)
  .max(256);

export function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(result.error);
  return result.data;
}
