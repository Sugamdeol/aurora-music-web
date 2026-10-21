import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { usePlaybackStore } from './store/playback';
import './styles.css';
import './refinements.css';
import './android-features.css';
import './player-polish.css';
import './smooth-mode.css';
import './player-reference.css';
import './mobile.css';
import './apple-music.css';

declare global {
  interface Window {
    __glassPointer?: boolean;
  }
}

// Dev-only handle so the player state can be inspected and driven from the
// console (visual QA, debugging playback without touching components).
if (import.meta.env.DEV) {
  (window as unknown as { __playbackStore?: unknown }).__playbackStore = usePlaybackStore;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

// Liquid glass pointer tracking — drives specular highlights on glass surfaces
if (typeof window !== 'undefined' && !window.__glassPointer) {
  window.__glassPointer = true;
  window.addEventListener(
    'mousemove',
    (e) => {
      document.documentElement.style.setProperty(
        '--glass-pointer-x',
        `${(e.clientX / window.innerWidth) * 100}%`
      );
      document.documentElement.style.setProperty(
        '--glass-pointer-y',
        `${(e.clientY / window.innerHeight) * 100}%`
      );
    },
    { passive: true }
  );
}

// Install the offline shell (public/sw.js). Dev mode skips registration so the
// service worker never interferes with the HMR pipeline.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').then((registration) => {
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'AURORA_SW_UPDATE_AVAILABLE') {
          registration.waiting?.postMessage({ type: 'AURORA_SW_SKIP_WAITING' });
        }
      });
    }).catch((error) => console.warn('Offline shell could not be installed:', error));

    // Swap to a new shell only when it is safe — never mid-song.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      if (!usePlaybackStore.getState().isPlaying) window.location.reload();
      else refreshing = false;
    });
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}><App /></QueryClientProvider>
  </React.StrictMode>,
);

