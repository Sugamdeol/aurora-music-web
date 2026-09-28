import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    css: true,
    // jsdom + fake-indexeddb are slow enough that default timeouts flake when
    // the full suite runs in parallel (CI machines are slower still).
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
