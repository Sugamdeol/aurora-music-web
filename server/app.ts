import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Express, type NextFunction } from 'express';
import helmet from 'helmet';
import { createApiRouter } from './routes/api.js';
import { createSyncRouter } from './routes/sync.js';
import { errorHandler, HttpError, notFoundHandler } from './errors.js';
import { YtDlpService, type AudioExtractor } from './services/ytdlp.js';
import { YouTubeMusicService, type MusicProvider } from './services/youtube.js';

export interface ViteMiddleware {
  (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void;
}

export interface CreateAppOptions {
  rootDir?: string;
  production?: boolean;
  viteMiddleware?: ViteMiddleware;
  music?: MusicProvider;
  audio?: AudioExtractor;
}

function configureTrustProxy(app: Express): void {
  const configured = process.env.TRUST_PROXY?.trim();
  if (!configured) return;
  if (/^\d+$/.test(configured)) app.set('trust proxy', Number(configured));
  else app.set('trust proxy', configured.split(',').map((value) => value.trim()).filter(Boolean));
}

function contentSecurityPolicy(production: boolean): Parameters<typeof helmet>[0] {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", ...(production ? [] : ["'unsafe-inline'", "'unsafe-eval'"])],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https:', ...(production ? [] : ['ws:', 'wss:'])],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        upgradeInsecureRequests: production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: production ? undefined : false,
  };
}

function staticCacheHeaders(res: ServerResponse, filePath: string): void {
  if (/\.(?:html|css|js|map|webmanifest)$/i.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache');
  } else if (/\.[a-f0-9]{8,}\.[a-z0-9]+$/i.test(path.basename(filePath))) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}

export function createApp(options: CreateAppOptions = {}): Express {
  const rootDir = options.rootDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const music = options.music ?? new YouTubeMusicService();
  const audio = options.audio ?? new YtDlpService();
  const app = express();

  app.disable('x-powered-by');
  configureTrustProxy(app);
  app.use(helmet(contentSecurityPolicy(production)));
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    const requestId = incoming && /^[A-Za-z0-9._-]{1,100}$/.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  app.use(express.json({ limit: '32kb', strict: true }));

  const api = createApiRouter({ music, audio });
  app.use('/api/v1/sync', createSyncRouter());
  app.use('/api/sync', createSyncRouter());
  app.use('/api/v1', (req, res, next) => {
    res.locals.apiVersion = 'v1';
    next();
  }, api, notFoundHandler);
  app.use('/api', (req, res, next) => {
    res.locals.apiVersion = 'compatibility';
    next();
  }, api, notFoundHandler);

  if (options.viteMiddleware) {
    app.use(options.viteMiddleware as unknown as express.RequestHandler);
  } else {
    const builtClient = path.join(rootDir, 'dist', 'client');
    const legacyClient = path.join(rootDir, 'public');
    const clientDir = existsSync(path.join(builtClient, 'index.html')) ? builtClient : legacyClient;

    app.use(express.static(clientDir, {
      extensions: ['html'],
      fallthrough: true,
      maxAge: '1h',
      setHeaders: staticCacheHeaders,
    }));

    app.get('/{*path}', (req, res, next) => {
      if (!req.accepts('html')) {
        next(new HttpError(404, 'NOT_FOUND', 'The requested resource does not exist.'));
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'), (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_req, _res, next: NextFunction) => {
    next(new HttpError(404, 'NOT_FOUND', 'The requested resource does not exist.'));
  });
  app.use(errorHandler);
  return app;
}
