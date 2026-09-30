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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

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
