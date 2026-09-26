import process from 'node:process';
import type { Innertube } from 'youtubei.js';

export interface MusicProvider {
  getHome(): Promise<unknown>;
  search(query: string, type: 'song' | 'video' | 'artist' | 'album' | 'playlist'): Promise<unknown>;
  getSuggestions(query: string): Promise<unknown>;
  getArtist(id: string): Promise<unknown>;
  getAlbum(id: string): Promise<unknown>;
  getPlaylist(id: string): Promise<unknown>;
  getRelated(id: string): Promise<unknown>;
  getLyrics(id: string): Promise<unknown>;
  getExplore(): Promise<unknown>;
}

type YouTubeModule = typeof import('youtubei.js');
let modulePromise: Promise<YouTubeModule> | undefined;

function supportsImportAttributes(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  return major > 20 || (major === 20 && minor >= 10);
}

function loadYouTubeModule(): Promise<YouTubeModule> {
  // youtubei.js 16 uses JSON import attributes, which Node 20.9 cannot parse even
  // though it is within this application's supported engine range. Its bundled
  // build avoids that syntax and provides the same public API as a fallback.
  modulePromise ??= (supportsImportAttributes()
    ? import('youtubei.js')
    : import('youtubei.js/web.bundle')) as Promise<YouTubeModule>;
  return modulePromise;
}

export class YouTubeMusicService implements MusicProvider {
  private clientPromise?: Promise<Innertube>;

  private client(): Promise<Innertube> {
    this.clientPromise ??= loadYouTubeModule()
      .then(({ Innertube: Client, UniversalCache }) => Client.create({ cache: new UniversalCache(false) }))
      .catch((error: unknown) => {
        this.clientPromise = undefined;
        throw error;
      });
    return this.clientPromise;
  }

  async getHome(): Promise<unknown> {
    return (await this.client()).music.getHomeFeed();
  }

  async search(query: string, type: 'song' | 'video' | 'artist' | 'album' | 'playlist'): Promise<unknown> {
    return (await this.client()).music.search(query, { type });
  }

  async getSuggestions(query: string): Promise<unknown> {
    return (await this.client()).music.getSearchSuggestions(query);
  }

  async getArtist(id: string): Promise<unknown> {
    return (await this.client()).music.getArtist(id);
  }

  async getAlbum(id: string): Promise<unknown> {
    return (await this.client()).music.getAlbum(id);
  }

  async getPlaylist(id: string): Promise<unknown> {
    return (await this.client()).music.getPlaylist(id);
  }

  async getRelated(id: string): Promise<unknown> {
    return (await this.client()).music.getRelated(id);
  }

  async getLyrics(id: string): Promise<unknown> {
    return (await this.client()).music.getLyrics(id);
  }

  async getExplore(): Promise<unknown> {
    return (await this.client()).music.getExplore();
  }
}
