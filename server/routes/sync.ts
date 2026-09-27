import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { asyncHandler, HttpError, sendError } from '../errors.js';

const scrypt = promisify(scryptCallback);
const COOKIE = 'aurora_sync';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
const passwordSchema = z.string().min(10).max(128);
const usernameSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/);
const syncSchema = z.object({
  tracks: z.array(z.object({ id: z.string().max(120), title: z.string().max(300), artist: z.string().max(300), artwork: z.string().max(2000).optional(), durationSeconds: z.number().finite().nonnegative().optional(), source: z.literal('remote'), kind: z.enum(['song','video']).default('song'), likedAt: z.number().finite().optional(), unlikedAt: z.number().finite().optional(), lastPlayedAt: z.number().finite().optional(), playCount: z.number().int().nonnegative().optional() }).passthrough()).max(500),
  playlists: z.array(z.object({ id: z.string().max(120), name: z.string().max(64), description: z.string().max(500).optional(), artwork: z.string().max(2000).optional(), createdAt: z.number().finite(), updatedAt: z.number().finite(), trackIds: z.array(z.string().max(120)).max(500) })).max(100),
  history: z.array(z.object({ trackId: z.string().max(120), playedAt: z.number().finite(), listenedSeconds: z.number().finite().optional(), trackTitle: z.string().max(300).optional(), artist: z.string().max(300).optional(), artwork: z.string().max(2000).optional() })).max(500),
  settings: z.object({ appearance: z.record(z.string(), z.unknown()).optional(), playback: z.record(z.string(), z.unknown()).optional() }),
}).strict();

type Snapshot = z.infer<typeof syncSchema>;
interface Account { username: string; salt: string; passwordHash: string; snapshot: Snapshot; updatedAt: number }
const accountLocks = new Map<string, Promise<unknown>>();

function configured(): { namespace: string; key: string } {
  const namespace = process.env.MANTLEDB_NAMESPACE?.trim();
  const key = process.env.MANTLEDB_KEY?.trim();
  if (!namespace || !key) throw new HttpError(503, 'SYNC_UNAVAILABLE', 'Account sync is not configured on the server yet.');
  return { namespace, key };
}

function accountPath(username: string): string { return createHash('sha256').update(username).digest('hex'); }
function initialSnapshot(): Snapshot { return { tracks: [], playlists: [], history: [], settings: {} }; }

async function mantle(method: 'GET'|'POST', path: string, body?: unknown): Promise<unknown> {
  const { namespace, key } = configured();
  const response = await fetch(`https://mantledb.sh/v2/${encodeURIComponent(namespace)}/accounts/${path}`, {
    method, headers: { 'X-Mantle-Key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error('MantleDB request failed:', response.status);
    throw new HttpError(response.status === 429 ? 503 : 502, 'SYNC_STORAGE_ERROR', response.status === 429 ? 'Sync is temporarily busy. Try again soon.' : 'Could not reach sync storage. Try again later.');
  }
  return response.json();
}

function cookieSecret(): string { return configured().key; }
function sign(payload: string): string { return createHmac('sha256', cookieSecret()).update(payload).digest('base64url'); }
function setSession(res: Response, username: string): void {
  const payload = Buffer.from(JSON.stringify({ username, expiresAt: Date.now() + SESSION_AGE })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1/sync', maxAge: SESSION_AGE });
}
function clearSession(res: Response): void { res.clearCookie(COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/v1/sync' }); }
function currentUsername(req: Request): string | null {
  const token = req.cookies?.[COOKIE] as string | undefined;
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload)); const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { username: string; expiresAt: number };
    return data.expiresAt > Date.now() ? data.username : null;
  } catch { return null; }
}
function requireAccount(req: Request, res: Response): string {
  const username = currentUsername(req);
  if (!username) { clearSession(res); throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to sync your library.'); }
  return username;
}
function cookieParser(req: Request, _res: Response, next: (error?: unknown) => void): void {
  const value = req.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`));
  if (value) { try { (req as Request & { cookies?: Record<string,string> }).cookies = { ...(req as Request & {cookies?:Record<string,string>}).cookies, [COOKIE]: decodeURIComponent(value.slice(COOKIE.length + 1)) }; } catch { /* ignore malformed cookie */ } }
  next();
}
function originGuard(req: Request, res: Response, next: (error?: unknown) => void): void {
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) throw new Error(); }
    catch { sendError(req, res, new HttpError(403, 'BAD_ORIGIN', 'This request is not allowed.')); return; }
  }
  next();
}
function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = accountLocks.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  accountLocks.set(key, current);
  void current.finally(() => { if (accountLocks.get(key) === current) accountLocks.delete(key); }).catch(() => undefined);
  return current;
}

export function createSyncRouter(): Router {
  const router = Router();
  router.use(cookieParser);
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
  router.get('/status', (_req, res) => res.set('Cache-Control', 'no-store').json({ configured: Boolean(process.env.MANTLEDB_NAMESPACE && process.env.MANTLEDB_KEY) }));
  router.post('/register', originGuard, authLimit, asyncHandler(async (req, res) => {
    const input = z.object({ username: usernameSchema, password: passwordSchema }).strict().parse(req.body);
    const id = accountPath(input.username);
    await serialize(id, async () => {
      if (await mantle('GET', id)) throw new HttpError(409, 'USERNAME_TAKEN', 'That username is already in use.');
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await scrypt(input.password, salt, 64) as Buffer).toString('hex');
      const account: Account = { username: input.username, salt, passwordHash, snapshot: initialSnapshot(), updatedAt: Date.now() };
      await mantle('POST', id, account);
    });
    setSession(res, input.username);
    res.set('Cache-Control', 'no-store').json({ username: input.username });
  }));
  router.post('/login', originGuard, authLimit, asyncHandler(async (req, res) => {
    const input = z.object({ username: usernameSchema, password: passwordSchema }).strict().parse(req.body);
    const account = await mantle('GET', accountPath(input.username)) as Account | null;
    if (!account || account.username !== input.username) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
    const actual = await scrypt(input.password, account.salt, 64) as Buffer;
    const expected = Buffer.from(account.passwordHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect.');
    setSession(res, account.username);
    res.set('Cache-Control', 'no-store').json({ username: account.username });
  }));
  router.get('/me', asyncHandler(async (req, res) => {
    const username = currentUsername(req);
    if (!username) { clearSession(res); res.status(200).set('Cache-Control', 'no-store').json({ user: null }); return; }
    res.set('Cache-Control', 'no-store').json({ user: { username } });
  }));
  router.post('/logout', originGuard, (_req, res) => { clearSession(res); res.status(204).end(); });
  router.get('/data', asyncHandler(async (req, res) => {
    const username = requireAccount(req, res);
    const account = await mantle('GET', accountPath(username)) as Account | null;
    if (!account) { clearSession(res); throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to sync your library.'); }
    res.set('Cache-Control', 'no-store').json({ snapshot: account.snapshot, updatedAt: account.updatedAt });
  }));
  router.put('/data', originGuard, asyncHandler(async (req, res) => {
    const username = requireAccount(req, res);
    const snapshot = syncSchema.parse(req.body);
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized) > 48_000) throw new HttpError(413, 'SYNC_TOO_LARGE', 'Your synced library is too large. Reduce history or playlist size and try again.');
    const id = accountPath(username);
    const account = await serialize(id, async () => {
      const existing = await mantle('GET', id) as Account | null;
      if (!existing || existing.username !== username) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in to sync your library.');
      const updated = { ...existing, snapshot, updatedAt: Date.now() };
      await mantle('POST', id, updated);
      return updated;
    });
    res.set('Cache-Control', 'no-store').json({ updatedAt: account.updatedAt });
  }));
  return router;
}
