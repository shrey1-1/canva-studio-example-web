/**
 * Starts the API server.
 * Environment (see .env.example):
 *   DATABASE_URL   PostgreSQL connection string. Unset = embedded PostgreSQL (PGlite) in DATA_DIR.
 *   DATA_DIR       Where the embedded database lives (default ./data/db, gitignored).
 *   PORT / HOST    Listen address (default 127.0.0.1:8787; the web dev server proxies /api here).
 *   SECURE_COOKIES "true" when served over HTTPS.
 *   AUTH_ATTEMPTS  Sign-in/sign-up attempts per 15 minutes per client (default 10).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { migrate, openPglite, openPostgres } from './db';

// Optional env file at the repository root (gitignored, never committed).
const envFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL;
const db = url ? await openPostgres(url) : await openPglite(resolve(process.env.DATA_DIR ?? 'data/db'));
const applied = await migrate(db);
const app = await buildApp({
  db,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  logger: true,
  authAttempts: Number(process.env.AUTH_ATTEMPTS) || undefined,
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
app.log.info(`Database: ${db.kind}${applied.length ? `, applied migrations ${applied.join(', ')}` : ''}`);

const stop = async () => {
  await app.close();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
