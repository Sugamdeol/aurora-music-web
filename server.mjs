import express from 'express';
import { Innertube, UniversalCache } from 'youtubei.js';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { platform } from 'node:os';

const app = express();
const port = Number(process.env.PORT || 4173);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
let clientPromise;
let homeCache;
const execFileAsync = promisify(execFile);
const extractedAudio = new Map();

function musicClient() {
  clientPromise ??= Innertube.create({ cache: new UniversalCache(false) });
  return clientPromise;
}

async function getAudioFormat(id, refresh = false) {
  const cached = extractedAudio.get(id);
  if (!refresh && cached && cached.expiresAt > Date.now()) return cached.format;
  const command = process.env.YT_DLP_PATH || (platform() === 'win32' ? 'py' : 'yt-dlp');
  const prefix = process.env.YT_DLP_PATH ? [] : (platform() === 'win32' ? ['-3', '-m', 'yt_dlp'] : []);
  const { stdout } = await execFileAsync(command, [
    ...prefix, '--no-warnings', '--no-playlist', '--skip-download', '--dump-single-json',
    '--format', 'bestaudio[ext=m4a]/bestaudio', `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`,
  ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const info = JSON.parse(stdout);
  const format = info.requested_downloads?.[0] || info;
  if (!format.url || !/^https:\/\//.test(format.url)) throw new Error('yt-dlp did not return a playable audio URL.');
  extractedAudio.set(id, { format, expiresAt: Date.now() + 3 * 60 * 1000 });
  return format;
}

const asText = (value) => value?.toString?.() || String(value || '');
function highResolutionThumbnail(value) {
  const raw = typeof value === 'string' ? value : value?.url || '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.hostname.endsWith('googleusercontent.com')) {
      url.pathname = url.pathname.replace(/=(?:w\d+-h\d+|s\d+)[^/]*$/, '=w1200-h1200-l90-rj');
    } else if (url.hostname.endsWith('ytimg.com')) {
      url.pathname = url.pathname.replace(/\/(?:default|mqdefault|hqdefault|sddefault)\.(jpg|webp)$/i, '/maxresdefault.$1');
    }
    return url.href;
  } catch { return raw; }
}

const lastThumbnail = (item) => {
  const thumbnails = item?.thumbnails || item?.thumbnail?.thumbnails || item?.thumbnail || [];
  const candidates = Array.isArray(thumbnails) ? thumbnails : thumbnails?.url ? [thumbnails] : [];
  const best = candidates.reduce((chosen, candidate) => {
    const area = Number(candidate?.width || 0) * Number(candidate?.height || 0);
    const chosenArea = Number(chosen?.width || 0) * Number(chosen?.height || 0);
    return area > chosenArea ? candidate : chosen;
  }, candidates[0]);
  return highResolutionThumbnail(best || candidates.at(-1));
};

function cleanItem(item, fallbackKind = 'song') {
  const endpoint = item.endpoint?.payload || {};
  const browseId = endpoint.browseEndpoint?.browseId || item.id || '';
  const videoId = endpoint.watchEndpoint?.videoId || item.id || '';
  const artists = item.artists?.map((artist) => ({
    name: artist.name,
    id: artist.channel_id || artist.endpoint?.payload?.browseEndpoint?.browseId || '',
  })) || [];
  const subtitle = asText(item.subtitle);
  const author = item.author?.name || item.authors?.map((artist) => artist.name).join(', ');
  const title = asText(item.title || item.name) || 'Untitled';
  const kind = item.item_type || fallbackKind;

  return {
    id: videoId,
    browseId,
    type: kind,
    title,
    artist: artists.map((artist) => artist.name).join(', ') || author || subtitle.split(' • ')[0] || 'Unknown artist',
    artistId: artists[0]?.id || '',
    artists,
    album: item.album?.name || '',
    albumId: item.album?.id || '',
    duration: item.duration?.text || '',
    thumbnail: lastThumbnail(item),
    subtitle,
    year: item.year || '',
    count: item.song_count || item.item_count || '',
  };
}

function cleanHeader(header) {
  return {
    title: asText(header?.title || header?.name) || 'Aurora Music',
    subtitle: asText(header?.subtitle || header?.second_subtitle),
    description: asText(header?.description),
    thumbnail: lastThumbnail(header),
  };
}

app.use(express.json({ limit: '32kb' }));
app.use(express.static(publicDir, {
  extensions: ['html'],
  maxAge: '1h',
  setHeaders(res, filePath) {
    if (/\.(html|css|js|webmanifest)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('/api/health', (_req, res) => res.json({ ready: true, service: 'Aurora Music Web' }));

app.get('/api/home', async (_req, res) => {
  if (homeCache && Date.now() - homeCache.savedAt < 5 * 60_000) return res.json(homeCache.data);
  try {
    const yt = await musicClient();
    const feed = await yt.music.getHomeFeed();
    const sections = (feed.sections || []).map((section) => ({
      title: asText(section.header?.title || section.title) || 'Made for you',
      items: (section.contents || []).map((item) => cleanItem(item, item.item_type || 'playlist')),
    })).filter((section) => section.items.length);
    const data = { sections, updatedAt: new Date().toISOString() };
    homeCache = { data, savedAt: Date.now() };
    res.set('Cache-Control', 'public, max-age=300').json(data);
  } catch (error) {
    console.error('Home feed failed:', error?.message || error);
    res.status(502).json({ error: 'Aurora could not load music right now. Try again in a moment.' });
  }
});

app.get('/api/search', async (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 120);
  const type = String(req.query.type || 'song').toLowerCase();
  const allowed = new Set(['song', 'video', 'artist', 'album', 'playlist']);
  if (!query) return res.status(400).json({ error: 'Type a song, artist, album, or playlist to search.' });
  if (!allowed.has(type)) return res.status(400).json({ error: 'Choose songs, videos, artists, albums, or playlists.' });
  try {
    const yt = await musicClient();
    const result = await yt.music.search(query, { type });
    const shelfName = type === 'song' ? 'songs' : `${type}s`;
    const items = (result[shelfName]?.contents || []).map((item) => cleanItem(item, type)).filter((item) => item.id);
    res.set('Cache-Control', 'private, max-age=45').json({ items, tracks: type === 'song' || type === 'video' ? items : undefined, query, type });
  } catch (error) {
    console.error('Search failed:', error?.message || error);
    res.status(502).json({ error: 'Music search is unavailable right now. Try again in a moment.' });
  }
});

app.get('/api/artist/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^(UC|FEmusic_library_privately_owned_artist)[\w-]{5,100}$/.test(id)) return res.status(400).json({ error: 'Invalid artist.' });
  try {
    const artist = await (await musicClient()).music.getArtist(id);
    const sections = (artist.sections || []).map((section) => ({
      title: asText(section.header?.title || section.title) || 'More music',
      items: (section.contents || []).map((item) => cleanItem(item, item.item_type || 'song')).filter((item) => item.id),
    }));
    res.json({ artist: cleanHeader(artist.header), sections });
  } catch (error) {
    console.error('Artist lookup failed:', error?.message || error);
    res.status(502).json({ error: 'This artist page could not be loaded.' });
  }
});

app.get('/api/album/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^(MPRE|FEmusic_library_privately_owned_release)[\w-]{5,100}$/.test(id)) return res.status(400).json({ error: 'Invalid album.' });
  try {
    const album = await (await musicClient()).music.getAlbum(id);
    const sections = [{
      title: 'Track list',
      items: (album.contents || []).map((item) => cleanItem(item, 'song')).filter((item) => item.id),
    }];
    res.json({ album: cleanHeader(album.header), sections });
  } catch (error) {
    console.error('Album lookup failed:', error?.message || error);
    res.status(502).json({ error: 'This album could not be loaded.' });
  }
});

app.get('/api/playlist/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^(VL|PL|RD|VLRD)[\w-]{5,120}$/.test(id)) return res.status(400).json({ error: 'Invalid playlist.' });
  try {
    const playlist = await (await musicClient()).music.getPlaylist(id);
    const items = (playlist.contents || []).map((item) => cleanItem(item, 'song')).filter((item) => item.id);
    res.json({ playlist: cleanHeader(playlist.header), items });
  } catch (error) {
    console.error('Playlist lookup failed:', error?.message || error);
    res.status(502).json({ error: 'This playlist could not be loaded.' });
  }
});

app.get('/api/related/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,20}$/.test(id)) return res.status(400).json({ error: 'Invalid track.' });
  try {
    const related = await (await musicClient()).music.getRelated(id);
    const sections = (related.contents || []).map((section) => ({
      title: asText(section.header?.title || section.title),
      items: (section.contents || []).map((item) => cleanItem(item, item.item_type || 'song')).filter((item) => item.id),
    }));
    res.set('Cache-Control', 'private, max-age=90').json({ sections });
  } catch (error) {
    console.error('Related music lookup failed:', error?.message || error);
    res.status(502).json({ error: 'Related music could not be loaded.' });
  }
});

app.get('/api/lyrics/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,20}$/.test(id)) return res.status(400).json({ error: 'Invalid track.' });
  try {
    const yt = await musicClient();
    const shelf = await yt.music.getLyrics(id);
    res.json({ lyrics: asText(shelf?.description) });
  } catch (error) {
    console.error('Lyrics lookup failed:', error?.message || error);
    res.status(502).json({ error: 'Lyrics could not be loaded.' });
  }
});

app.get('/api/stream/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[\w-]{6,20}$/.test(id)) return res.status(400).end('Invalid track');
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    let upstream;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const format = await getAudioFormat(id, attempt > 0);
      const headers = { ...(format.http_headers || {}) };
      if (req.headers.range) headers.Range = req.headers.range;
      upstream = await fetch(format.url, { headers, signal: controller.signal });
      if (upstream.ok && upstream.body) break;
      extractedAudio.delete(id);
      if (attempt === 1) return res.status(502).type('application/json').json({ error: `yt-dlp could not fetch this track (upstream ${upstream.status}). Try another song.` });
      await upstream.body?.cancel().catch(() => {});
    }
    if (!upstream?.ok || !upstream.body) return res.status(502).type('application/json').json({ error: 'yt-dlp did not return an audio stream.' });
    res.status(upstream.status);
    for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(key);
      if (value) res.setHeader(key, value);
    }
    res.setHeader('cache-control', 'no-store');
    const audioStream = Readable.fromWeb(upstream.body);
    audioStream.on('error', (error) => {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      console.error('Audio stream interrupted:', error?.message || error);
      if (!res.headersSent) res.status(502).end('Audio stream interrupted. Try again.');
      else res.destroy(error);
    });
    audioStream.pipe(res);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Stream request failed:', error?.message || error);
    if (!res.headersSent) {
      const missing = error?.code === 'ENOENT';
      res.status(missing ? 503 : 502).type('application/json').json({ error: missing
        ? 'yt-dlp is required for playback. Install it with: py -3 -m pip install --user -r web/requirements.txt'
        : 'Could not start playback. yt-dlp could not extract this song.' });
    }
  }
});

app.get('*path', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.listen(port, () => console.log(`Aurora Music Web listening on http://localhost:${port}`));
