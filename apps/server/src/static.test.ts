import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { migrate, openPglite, type Db } from './db';

let db: Db;
let app: FastifyInstance;
let root: string;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cs-web-'));
  const dist = join(root, 'dist');
  mkdirSync(join(dist, 'assets'), { recursive: true });
  writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Canvas Studio</title>');
  writeFileSync(join(dist, 'assets', 'app-123.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.txt'), 'outside');
  db = await openPglite();
  await migrate(db);
  app = await buildApp({ db, webDir: dist });
}, 60_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

describe('serving the web app', () => {
  it('serves the app shell, including for client-side routes', async () => {
    for (const url of ['/', '/file/abc']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.body).toContain('Canvas Studio');
    }
  });

  it('serves built files with long caching', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app-123.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/javascript');
    expect(res.headers['cache-control']).toContain('immutable');
  });

  it('never serves files outside the build folder', async () => {
    for (const url of ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body).not.toContain('outside');
    }
  });

  it('still applies the CSRF check to API routes reached through an encoded path', async () => {
    const res = await app.inject({ method: 'POST', url: '/%61pi/projects', payload: { name: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('keeps 404s for missing files and unknown API routes', async () => {
    expect((await app.inject({ method: 'GET', url: '/assets/missing.js' })).statusCode).toBe(404);
    const api = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'Not found.' });
  });
});
