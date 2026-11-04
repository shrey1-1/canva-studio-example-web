/**
 * The HTTP API (all routes under /api). Built as a function so tests can run it against an
 * in-memory database with `app.inject`.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { SESSION_COOKIE, userForSession, userForToken, type SessionUser } from './auth';
import { HttpError } from './access';
import type { Db } from './db';
import { authRoutes } from './routes/auth';
import { projectRoutes } from './routes/projects';
import { fileRoutes } from './routes/files';
import { assetRoutes } from './routes/assets';
import { tokenRoutes } from './routes/tokens';
import { commentRoutes } from './routes/comments';
import { accountRoutes } from './routes/account';
import type { CollabHub } from './collab';
import { webHandler } from './static';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppOptions {
  db: Db;
  /** Mark the session cookie Secure (on when served over HTTPS). */
  secureCookies?: boolean;
  logger?: boolean;
  /** Login/signup attempts allowed per 15 minutes per client (default 10). */
  authAttempts?: number;
  /** Real-time rooms; HTTP writes notify it so open editors stay current. */
  hub?: CollabHub;
  /** Built editor to serve on the same port (apps/web/dist). Unset = API only. */
  webDir?: string;
}

/** Header every state-changing request must carry. Browsers cannot add it cross-site without a CORS preflight, which this server never allows, so it blocks CSRF. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'canvas-studio';

/** What agent tokens may do: read projects/files/comments, edit files, add images and comments. Never accounts, tokens or sharing. */
const UUID = '[0-9a-f-]{36}';
const TOKEN_ROUTES = [
  new RegExp(`^GET /api/(projects|files/recent|projects/${UUID}|files/${UUID}|files/${UUID}/(versions|comments)|assets/[0-9a-f]{64})$`),
  new RegExp(`^(PUT|PATCH) /api/files/${UUID}$`),
  new RegExp(`^POST /api/(projects/${UUID}/files|files/${UUID}/(comments|versions|duplicate))$`),
  new RegExp(`^PUT /api/projects/${UUID}/assets/[0-9a-f]{64}$`),
];

export async function buildApp({ db, secureCookies = false, logger = false, authAttempts = 10, hub, webDir }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 1024 * 1024, trustProxy: false });
  await app.register(cookie);

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Cache-Control', 'no-store');
    // Web app files (requests no API route matched) need no user lookup. Decided by the matched
    // route, not the raw URL, so an encoded path like /%61pi/... cannot skip these checks.
    if (!req.routeOptions.url) return;
    const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (bearer) {
      // Agent tokens: no cookie is involved, so CSRF does not apply; scope limits do.
      req.user = await userForToken(db, bearer);
      if (!req.user) throw new HttpError(401, 'Invalid or revoked access token.');
      const write = !['GET', 'HEAD'].includes(req.method);
      const path = req.url.split('?')[0]!;
      if (!TOKEN_ROUTES.some((r) => r.test(`${req.method} ${path}`))) throw new HttpError(403, 'Access tokens cannot use this endpoint.');
      if (write && req.user.token!.scopes !== 'write') throw new HttpError(403, 'This token is read-only.');
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
      throw new HttpError(403, 'Missing request header.');
    }
    req.user = await userForSession(db, req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) return reply.status(error.status).send({ error: error.message, ...error.details });
    const e = error as { validation?: unknown; statusCode?: number; code?: string; message: string };
    if (e.validation) return reply.status(400).send({ error: `Invalid request: ${e.message}` });
    if (e.code === '22P02') return reply.status(404).send({ error: 'Not found.' }); // malformed uuid
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    req.log.error(error);
    return reply.status(500).send({ error: 'Something went wrong on the server.' });
  });

  app.get('/api/health', async () => ({ ok: true, database: db.kind }));
  await app.register(authRoutes, { db, secureCookies, authAttempts });
  await app.register(projectRoutes, { db });
  await app.register(fileRoutes, { db, hub });
  await app.register(assetRoutes, { db });
  await app.register(tokenRoutes, { db });
  await app.register(commentRoutes, { db, hub });
  await app.register(accountRoutes, { db });
  const web = webDir ? webHandler(webDir) : null;
  app.setNotFoundHandler(async (req, reply) => {
    if (web && (await web(req, reply))) return reply;
    return reply.status(404).send({ error: 'Not found.' });
  });
  return app;
}
