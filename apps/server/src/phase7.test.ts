import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { createRectangle, type DesignDocument } from '@canvas-studio/core';
import { buildApp, CSRF_HEADER, CSRF_VALUE } from './app';
import { CollabHub } from './collab';
import { migrate, openPglite, type Db } from './db';
import { collectUnusedAssets } from './routes/account';

let db: Db;
let app: FastifyInstance;
let hub: CollabHub;
let base = '';

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  hub = new CollabHub(db);
  app = await buildApp({ db, hub, authAttempts: 1000 });
  hub.attach(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  base = `127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);
afterAll(async () => {
  await hub.shutdown();
  await app.close();
  await db.close();
});

async function signup(name: string) {
  const email = `${name}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email, name, password: 'correct horse' } });
  const cookie = `cs_session=${res.cookies.find((c) => c.name === 'cs_session')!.value}`;
  const call = async (method: string, url: string, payload?: unknown, auth?: string) => {
    const r = await app.inject({ method: method as 'GET', url, payload: payload as never, headers: auth ? { authorization: `Bearer ${auth}` } : { cookie, [CSRF_HEADER]: CSRF_VALUE } });
    return { status: r.statusCode, body: r.body ? r.json() : null };
  };
  const projectId = (await call('GET', '/api/projects')).body.projects[0].id as string;
  return { email, cookie, call, projectId, userId: res.json().user.id as string };
}

/** Opens a collaboration socket and collects its messages. */
function connect(fileId: string, cookie: string, origin = `http://${base}`) {
  const ws = new WebSocket(`ws://${base}/api/collab?file=${fileId}`, { headers: { cookie, origin } });
  const messages: Record<string, unknown>[] = [];
  const waiters: { t: string; resolve: (m: Record<string, unknown>) => void }[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString()) as Record<string, unknown>;
    messages.push(m);
    const i = waiters.findIndex((w) => w.t === m.t);
    if (i >= 0) waiters.splice(i, 1)[0]!.resolve(m);
  });
  const next = (t: string) => {
    const found = messages.findIndex((m) => m.t === t);
    if (found >= 0) return Promise.resolve(messages.splice(found, 1)[0]!);
    return new Promise<Record<string, unknown>>((resolve) => waiters.push({ t, resolve }));
  };
  const opened = new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });
  return { ws, next, opened, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

describe('agent access tokens', () => {
  it('lets agents read and write files within their scope only', async () => {
    const a = await signup('agent-owner');
    const other = (await a.call('POST', '/api/projects', { name: 'Private' })).body.project.id;
    const file = (await a.call('POST', `/api/projects/${a.projectId}/files`, { name: 'Shared' })).body.file;
    const ro = (await a.call('POST', '/api/tokens', { name: 'Reader', scopes: 'read', projectId: a.projectId })).body;
    const rw = (await a.call('POST', '/api/tokens', { name: 'Writer', scopes: 'write' })).body;
    expect(ro.secret).toMatch(/^cs_pat_/);
    expect((await a.call('GET', '/api/tokens')).body.tokens).toHaveLength(2);

    const doc = (await a.call('GET', `/api/files/${file.id}`, undefined, ro.secret)).body.file.document;
    expect((await a.call('PUT', `/api/files/${file.id}`, { document: doc, baseRevision: 1 }, ro.secret)).status).toBe(403);
    expect((await a.call('GET', `/api/projects/${other}`, undefined, ro.secret)).status).toBe(404);
    // Images in another project are invisible to a project-limited token.
    const sha = 'c'.repeat(64);
    await db.query(`insert into assets (project_id, id, mime, size, width, height, data) values ($1, $2, 'image/png', 1, 1, 1, $3)`, [other, sha, Buffer.from([1])]);
    const asset = (secret: string) => app.inject({ method: 'GET', url: `/api/assets/${sha}`, headers: { authorization: `Bearer ${secret}` } }).then((r) => r.statusCode);
    expect(await asset(ro.secret)).toBe(404);
    expect(await asset(rw.secret)).toBe(200);
    expect((await a.call('GET', '/api/projects', undefined, ro.secret)).body.projects).toHaveLength(1);
    expect((await a.call('PUT', `/api/files/${file.id}`, { document: doc, baseRevision: 1 }, rw.secret)).status).toBe(200);
    // Tokens can never manage accounts, tokens or sharing.
    expect((await a.call('POST', '/api/tokens', { name: 'x', scopes: 'write' }, rw.secret)).status).toBe(403);
    expect((await a.call('POST', `/api/projects/${a.projectId}/members`, { email: 'x@example.com', role: 'owner' }, rw.secret)).status).toBe(403);
    expect((await a.call('DELETE', `/api/projects/${a.projectId}`, undefined, rw.secret)).status).toBe(403);

    expect((await a.call('DELETE', `/api/tokens/${rw.token.id}`)).status).toBe(204);
    expect((await a.call('GET', '/api/projects', undefined, rw.secret)).status).toBe(401);
    const { rows } = await db.query<{ token_hash: string }>('select token_hash from api_tokens limit 1');
    expect(rows[0]!.token_hash).not.toContain('cs_pat_');
  });
});

describe('comments', () => {
  it('supports threads with author / editor / owner rules', async () => {
    const owner = await signup('c-owner');
    const viewer = await signup('c-viewer');
    const file = (await owner.call('POST', `/api/projects/${owner.projectId}/files`, {})).body.file;
    await owner.call('POST', `/api/projects/${owner.projectId}/members`, { email: viewer.email, role: 'viewer' });
    expect((await viewer.call('POST', `/api/files/${file.id}/comments`, { body: 'Hi' })).status).toBe(400);
    const c = (await viewer.call('POST', `/api/files/${file.id}/comments`, { body: 'Bigger logo?', pageId: 'p', x: 10, y: 20 })).body.comment;
    expect(c).toMatchObject({ body: 'Bigger logo?', author: 'c-viewer', resolved: false });
    expect((await owner.call('POST', `/api/files/${file.id}/comments`, { body: 'Done', parentId: c.id })).status).toBe(201);
    expect((await owner.call('PATCH', `/api/comments/${c.id}`, { body: 'hijack' })).status).toBe(403);
    expect((await owner.call('PATCH', `/api/comments/${c.id}`, { resolved: true })).status).toBe(200);
    const list = (await viewer.call('GET', `/api/files/${file.id}/comments`)).body.comments;
    expect(list.map((x: { body: string; resolved: boolean }) => [x.body, x.resolved])).toEqual([['Bigger logo?', true], ['Done', false]]);
    expect((await owner.call('DELETE', `/api/comments/${c.id}`)).status).toBe(204);
    expect((await viewer.call('GET', `/api/files/${file.id}/comments`)).body.comments).toEqual([]);
  });
});

describe('live collaboration', () => {
  it('syncs changes between editors, rejects invalid or viewer changes, and saves', async () => {
    const a = await signup('live-a');
    const b = await signup('live-b');
    const v = await signup('live-v');
    const file = (await a.call('POST', `/api/projects/${a.projectId}/files`, {})).body.file;
    await a.call('POST', `/api/projects/${a.projectId}/members`, { email: b.email, role: 'editor' });
    await a.call('POST', `/api/projects/${a.projectId}/members`, { email: v.email, role: 'viewer' });

    const ca = connect(file.id, a.cookie);
    await ca.opened;
    const init = (await ca.next('init')) as { doc: DesignDocument; role: string };
    expect(init.role).toBe('owner');
    const cb = connect(file.id, b.cookie);
    await cb.opened;
    await cb.next('init');
    expect(((await ca.next('join')) as { peer: { name: string } }).peer.name).toBe('live-b');

    const rect = createRectangle({ pageId: init.doc.pages[0]!.id, name: 'Live', width: 10, height: 10 });
    const pages = init.doc.pages.map((p) => ({ ...p, childIds: [...p.childIds, rect.id] }));
    ca.send({ t: 'change', id: 'c1', change: { nodes: { [rect.id]: rect }, pages } });
    expect(await ca.next('ack')).toMatchObject({ id: 'c1' });
    const got = (await cb.next('change')) as { change: { nodes: Record<string, { name: string }> } };
    expect(got.change.nodes[rect.id]!.name).toBe('Live');

    // A change that breaks the document (orphan node) is refused with the real document.
    cb.send({ t: 'change', id: 'bad', change: { nodes: { orphan: { ...rect, id: 'orphan' } } } });
    expect(await cb.next('reject')).toMatchObject({ id: 'bad' });

    const cv = connect(file.id, v.cookie);
    await cv.opened;
    await cv.next('init');
    cv.send({ t: 'change', id: 'v1', change: { name: 'Hacked' } });
    expect(await cv.next('reject')).toMatchObject({ reason: 'View only' });

    cb.send({ t: 'presence', presence: { pageId: 'p', cursor: { x: 5, y: 6 }, selection: [rect.id] } });
    expect(((await ca.next('presence')) as { peer: { presence: { cursor: { x: number } } } }).peer.presence.cursor.x).toBe(5);

    const saved = (await ca.next('saved')) as { revision: number };
    expect(saved.revision).toBe(2);
    const stored = (await a.call('GET', `/api/files/${file.id}`)).body.file;
    expect(stored.document.nodes[rect.id].name).toBe('Live');
    expect(stored.document.name).not.toBe('Hacked');

    // An HTTP write (e.g. an agent) reaches open editors as a reset.
    await a.call('PATCH', `/api/files/${file.id}`, { name: 'Renamed by API' });
    expect(((await cb.next('reset')) as { doc: DesignDocument }).doc.name).toBe('Renamed by API');
    for (const c of [ca, cb, cv]) c.ws.close();
  });

  it('refuses cross-site and anonymous sockets', async () => {
    const a = await signup('live-x');
    const file = (await a.call('POST', `/api/projects/${a.projectId}/files`, {})).body.file;
    await expect(connect(file.id, a.cookie, 'https://evil.example').opened).rejects.toThrow(/403/);
    await expect(connect(file.id, 'cs_session=nope').opened).rejects.toThrow(/403/);
  });
});

describe('account data rights', () => {
  it('exports personal data and deletes the account, keeping projects shared with other owners', async () => {
    const a = await signup('leaver');
    const b = await signup('stayer');
    const shared = (await a.call('POST', '/api/projects', { name: 'Shared' })).body.project.id;
    await a.call('POST', `/api/projects/${shared}/members`, { email: b.email, role: 'editor' });
    await a.call('POST', `/api/projects/${a.projectId}/files`, { name: 'Mine' });

    const exp = await app.inject({ method: 'GET', url: '/api/account/export', headers: { cookie: a.cookie } });
    expect(exp.headers['content-disposition']).toContain('attachment');
    expect(exp.json()).toMatchObject({ profile: { name: 'leaver' }, files: [{ name: 'Mine' }] });

    expect((await a.call('DELETE', '/api/account', { password: 'wrong password' })).status).toBe(401);
    // Only owner of a project someone else uses: refused until ownership is shared.
    expect((await a.call('DELETE', '/api/account', { password: 'correct horse' })).status).toBe(409);
    await a.call('PATCH', `/api/projects/${shared}/members/${b.userId}`, { role: 'owner' });
    expect((await a.call('DELETE', '/api/account', { password: 'correct horse' })).status).toBe(204);

    expect((await a.call('GET', '/api/auth/me')).status).toBe(401);
    expect((await b.call('GET', `/api/projects/${shared}`)).status).toBe(200);
    const left = await db.query('select 1 from projects where id = $1', [a.projectId]);
    expect(left.rows).toHaveLength(0);
  });

  it('removes images that no file or version uses', async () => {
    const a = await signup('gc');
    await db.query(`insert into assets (project_id, id, mime, size, width, height, data, created_at) values ($1, $2, 'image/png', 1, 1, 1, $3, now() - interval '2 hours')`, [a.projectId, 'a'.repeat(64), Buffer.from([1])]);
    await db.query(`insert into assets (project_id, id, mime, size, width, height, data) values ($1, $2, 'image/png', 1, 1, 1, $3)`, [a.projectId, 'b'.repeat(64), Buffer.from([1])]);
    expect(await collectUnusedAssets(db)).toBeGreaterThanOrEqual(1);
    const { rows } = await db.query<{ id: string }>('select id from assets where project_id = $1', [a.projectId]);
    expect(rows.map((r) => r.id)).toEqual(['b'.repeat(64)]); // recent upload kept
  });
});
