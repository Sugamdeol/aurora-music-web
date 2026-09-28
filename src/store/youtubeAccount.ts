import { create } from 'zustand';
import type { MediaTrack } from '../domain/media';
import { api } from '../lib/api';

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const scope = 'https://www.googleapis.com/auth/youtube.readonly';

interface GoogleTokenResponse { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
interface GoogleTokenClient { requestAccessToken(options?: { prompt?: string }): void }
interface GoogleIdentity { accounts: { oauth2: { initTokenClient(options: { client_id: string; scope: string; callback(response: GoogleTokenResponse): void; error_callback?(error: { type?: string; message?: string }): void }): GoogleTokenClient } } }
declare global { interface Window { google?: GoogleIdentity } }

let identityScript: Promise<void> | undefined;
export function prepareGoogleIdentity(): Promise<void> {
  // Loading the GSI script when no client id is configured just burns a
  // request and trips the CSP console error.
  if (!clientId) return Promise.reject(new Error('Google sign-in is not configured for this site.'));
  if (window.google?.accounts.oauth2) return Promise.resolve();
  identityScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => window.google?.accounts.oauth2 ? resolve() : reject(new Error('Google sign-in did not load.'));
    script.onerror = () => reject(new Error('Google sign-in could not load. Check your connection.'));
    document.head.append(script);
  });
  return identityScript;
}

function requestGoogleToken(): Promise<GoogleTokenResponse> {
  return new Promise((resolve, reject) => {
    const google = window.google?.accounts.oauth2;
    if (!google || !clientId) { reject(new Error('Google sign-in is not configured for this site yet.')); return; }
    const client = google.initTokenClient({
      client_id: clientId,
      scope,
      callback: (response) => response.access_token ? resolve(response) : reject(new Error(response.error_description || response.error || 'Google sign-in was not completed.')),
      error_callback: (error) => reject(new Error(error.message || 'Google sign-in was closed before it finished.')),
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });
}

interface YouTubeAccountState {
  configured: boolean;
  connected: boolean;
  connecting: boolean;
  name: string;
  avatar: string;
  likedTracks: MediaTrack[];
  error?: string;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const useYouTubeAccountStore = create<YouTubeAccountState>((set) => ({
  configured: Boolean(clientId),
  connected: false,
  connecting: false,
  name: '',
  avatar: '',
  likedTracks: [],
  connect: async () => {
    set({ connecting: true, error: undefined });
    try {
      const token = await requestGoogleToken();
      const account = await api.youtubeMusicAccount(token.access_token!);
      set({ connected: true, connecting: false, name: account.name || 'YouTube Music', avatar: account.avatar, likedTracks: account.tracks, error: undefined });
    } catch (error) {
      set({ connected: false, connecting: false, name: '', avatar: '', likedTracks: [], error: error instanceof Error ? error.message : 'Google sign-in failed.' });
    }
  },
  disconnect: () => set({ connected: false, connecting: false, name: '', avatar: '', likedTracks: [], error: undefined }),
}));
