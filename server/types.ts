export type MusicItemType = 'song' | 'video' | 'artist' | 'album' | 'playlist' | string;

export interface ArtistReference {
  name: string;
  id: string;
}

export interface MusicItem {
  id: string;
  browseId: string;
  type: MusicItemType;
  title: string;
  artist: string;
  artistId: string;
  artists: ArtistReference[];
  album: string;
  albumId: string;
  duration: string;
  thumbnail: string;
  subtitle: string;
  year: string;
  count: string;
}

export interface MusicHeader {
  title: string;
  subtitle: string;
  description: string;
  thumbnail: string;
}

export interface MusicSection {
  title: string;
  items: MusicItem[];
}

export interface ExploreCategory {
  title: string;
  browseId: string;
}

export interface AudioFormat {
  url: string;
  mimeType?: string;
  contentLength?: number;
  httpHeaders: Record<string, string>;
}

export interface YtDlpStatus {
  ready: boolean;
  command: string;
  version?: string;
  reason?: string;
}
