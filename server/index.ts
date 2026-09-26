import { createServer, type Server } from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { setDefaultResultOrder } from 'node:dns';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ViteDevServer } from 'vite';
import { createApp } from './app.js';

export { createApp } from './app.js';
export * from './normalizers.js';
export * from './validation.js';

export interface RunningServer {
  server: Server;
  vite?: ViteDevServer;
  close(): Promise<void>;
}

function serverPort(): number {
  const value = Number(process.env.PORT ?? 4173);
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return value;
}

export async function startServer(): Promise<RunningServer> {
  // Prefer working IPv4 routes while retaining IPv6-only host support.
  setDefaultResultOrder('ipv4first');
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const production = process.env.NODE_ENV === 'production';
  let vite: ViteDevServer | undefined;

  if (!production) {
    const { createServer: createViteServer } = await import('vite');
    vite = await createViteServer({
      root: rootDir,
      appType: 'spa',
      server: { middlewareMode: true },
    });
  }

  const app = createApp({ rootDir, production, viteMiddleware: vite?.middlewares });
  const server = createServer(app);
  server.headersTimeout = 65_000;
  server.requestTimeout = 70_000;
  server.keepAliveTimeout = 5_000;

  const port = serverPort();
  const host = process.env.HOST?.trim();
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      if (host) server.listen(port, host, onListening);
      else server.listen(port, onListening);
    });
  } catch (error) {
    await vite?.close();
    throw error;
  }

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Aurora Music Web listening on http://${host || 'localhost'}:${actualPort}`);

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        const timer = setTimeout(() => server.closeAllConnections(), 5_000);
        timer.unref?.();
      });
      await vite?.close();
    })();
    return closing;
  };

  return { server, vite, close };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  startServer().then((running) => {
    const shutdown = (signal: NodeJS.Signals): void => {
      console.log(`${signal} received; shutting down.`);
      void running.close().then(() => process.exit(0), (error: unknown) => {
        console.error('Graceful shutdown failed:', error);
        process.exit(1);
      });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  }).catch((error: unknown) => {
    console.error('Aurora Music Web failed to start:', error);
    process.exitCode = 1;
  });
}
