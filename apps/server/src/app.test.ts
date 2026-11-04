import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addNode, createDocument, createImage, type DesignDocument } from '@canvas-studio/core';
import { buildApp, CSRF_HEADER, CSRF_VALUE } from './app';
import { migrate, openPglite, type Db } from './db';

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  app = await buildApp({ db, authAttempts: 1000 });
}, 60_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A signed-in API client with its own cookie. */
async function signup(name: string) {
  const email = `${name.toLowerCase()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email, name, password: 'correct horse' } });
  expect(res.statusCode).toBe(201);
  const cookie = res.cookies.find((c) => c.name === 'cs_session')!;
  const call = async (method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method, url, payload: payload as never, headers: { cookie: `cs_session=${cookie.value}`, [CSRF_HEADER]: CSRF_VALUE, ...headers } });
    return { status: r.statusCode, body: r.body ? (r.headers['content-type']?.toString().includes('json') ? r.json() : r.rawPayload) : null };
  };
  const { body } = await call('GET', '/api/projects');
  return { email, call, projectId: body.projects[0].id as string, user: res.json().user as { id: string } };
}

describe('accounts', () => {
  it('limits repeated login attempts', async () => {
    const strict = await buildApp({ db, authAttempts: 3 });
    const attempt = () => strict.inject({ method: 'POST', url: '/api/auth/login', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email: 'nobody@example.com', password: 'whatever1' } });
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await attempt()).statusCode);
    expect(codes).toEqual([401, 401, 401, 429]);
    await strict.close();
  });

  it('signs up, reads the session, logs out and logs back in', async () => {
    const a = await signup('Ada');
    expect((await a.call('GET', '/api/auth/me')).body.user.email).toBe(a.email);
    expect((await a.call('POST', '/api/auth/logout')).status).toBe(204);
    expect((await a.call('GET', '/api/auth/me')).status).toBe(401);
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email: a.email, password: 'wrong password' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email: a.email.toUpperCase(), password: 'correct horse' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
  });

  it('refuses duplicate emails, short passwords and requests without the CSRF header', async () => {
    const a = await signup('Bob');
    const dup = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email: a.email, name: 'X', password: 'longenough' } });
    expect(dup.statusCode).toBe(409);
    const short = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email: 'z@example.com', name: 'Z', password: 'short' } });
    expect(short.statusCode).toBe(400);
    const csrf = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' } });
    expect(csrf.statusCode).toBe(403);
  });

  it('stores only hashes of passwords and session tokens', async () => {
    await signup('Hash');
    const { rows } = await db.query<{ password_hash: string }>('select password_hash from users limit 1');
    expect(rows[0]!.password_hash).toMatch(/^scrypt\$/);
    const s = await db.query<{ token_hash: string }>('select token_hash from sessions limit 1');
    expect(s.rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('projects, roles and files', () => {
  it('keeps projects private to their members', async () => {
    const a = await signup('Owner');
    const b = await signup('Stranger');
    expect((await b.call('GET', `/api/projects/${a.projectId}`)).status).toBe(404);
    const file = await a.call('POST', `/api/projects/${a.projectId}/files`, { name: 'Secret' });
    expect((await b.call('GET', `/api/files/${file.body.file.id}`)).status).toBe(404);
    expect((await b.call('GET', '/api/files/not-a-uuid')).status).toBe(400);
  });

  it('saves with revisions and rejects stale or invalid saves', async () => {
    const a = await signup('Saver');
    const { body } = await a.call('POST', `/api/projects/${a.projectId}/files`, { name: 'Draft' });
    const id = body.file.id as string;
    const loaded = (await a.call('GET', `/api/files/${id}`)).body.file;
    const doc = loaded.document as DesignDocument;
    expect(loaded.revision).toBe(1);
    const saved = await a.call('PUT', `/api/files/${id}`, { document: { ...doc, name: 'Renamed' }, baseRevision: 1 });
    expect(saved.body.revision).toBe(2);
    expect((await a.call('PUT', `/api/files/${id}`, { document: doc, baseRevision: 1 })).status).toBe(409);
    expect((await a.call('PUT', `/api/files/${id}`, { document: { ...doc, nodes: { x: { id: 'x' } } }, baseRevision: 2 })).status).toBe(400);
    expect((await a.call('PUT', `/api/files/${id}`, { document: { ...doc, id: crypto.randomUUID() }, baseRevision: 2 })).status).toBe(400);
    const recent = (await a.call('GET', '/api/files/recent')).body.files;
    expect(recent[0]).toMatchObject({ id, name: 'Renamed', revision: 2, pageCount: 1 });
  });

  it('enforces viewer / editor / owner roles', async () => {
    const owner = await signup('Lead');
    const viewer = await signup('Viewer');
    const file = (await owner.call('POST', `/api/projects/${owner.projectId}/files`, {})).body.file;
    expect((await owner.call('POST', `/api/projects/${owner.projectId}/members`, { email: viewer.email, role: 'viewer' })).status).toBe(201);
    const doc = (await viewer.call('GET', `/api/files/${file.id}`)).body.file.document;
    expect((await viewer.call('PUT', `/api/files/${file.id}`, { document: doc, baseRevision: 1 })).status).toBe(403);
    expect((await viewer.call('POST', `/api/projects/${owner.projectId}/members`, { email: viewer.email, role: 'owner' })).status).toBe(403);
    await owner.call('PATCH', `/api/projects/${owner.projectId}/members/${viewer.user.id}`, { role: 'editor' });
    expect((await viewer.call('PUT', `/api/files/${file.id}`, { document: doc, baseRevision: 1 })).status).toBe(200);
    // The last owner cannot leave or be demoted.
    expect((await owner.call('DELETE', `/api/projects/${owner.projectId}/members/${owner.user.id}`)).status).toBe(409);
    expect((await viewer.call('DELETE', `/api/projects/${owner.projectId}/members/${viewer.user.id}`)).status).toBe(204);
    expect((await viewer.call('GET', `/api/files/${file.id}`)).status).toBe(404);
  });

  it('manages folders without cycles; deleting a folder keeps its files', async () => {
    const a = await signup('Folders');
    const f1 = (await a.call('POST', `/api/projects/${a.projectId}/folders`, { name: 'Design' })).body.folder;
    const f2 = (await a.call('POST', `/api/projects/${a.projectId}/folders`, { name: 'Sub', parentId: f1.id })).body.folder;
    expect((await a.call('PATCH', `/api/folders/${f1.id}`, { parentId: f2.id })).status).toBe(400);
    const file = (await a.call('POST', `/api/projects/${a.projectId}/files`, { folderId: f2.id })).body.file;
    expect((await a.call('DELETE', `/api/folders/${f1.id}`)).status).toBe(204);
    const project = (await a.call('GET', `/api/projects/${a.projectId}`)).body;
    expect(project.folders).toEqual([]);
    expect(project.files.find((f: { id: string }) => f.id === file.id).folderId).toBeNull();
  });

  it('keeps automatic and named versions, and restores them reversibly', async () => {
    const a = await signup('Versions');
    const id = (await a.call('POST', `/api/projects/${a.projectId}/files`, { name: 'V1' })).body.file.id;
    const doc = (await a.call('GET', `/api/files/${id}`)).body.file.document;
    await a.call('PUT', `/api/files/${id}`, { document: { ...doc, name: 'V2' }, baseRevision: 1 });
    await a.call('POST', `/api/files/${id}/versions`, { label: 'Milestone' });
    await a.call('PUT', `/api/files/${id}`, { document: { ...doc, name: 'V3' }, baseRevision: 2 });
    const versions = (await a.call('GET', `/api/files/${id}/versions`)).body.versions;
    expect(versions.map((v: { label: string | null; auto: boolean }) => v.label ?? 'auto')).toEqual(['Milestone', 'auto']);
    const restored = await a.call('POST', `/api/files/${id}/versions/${versions[0].id}/restore`);
    expect(restored.body.document.name).toBe('V2');
    expect(restored.body.revision).toBe(4);
    const after = (await a.call('GET', `/api/files/${id}/versions`)).body.versions;
    expect(after[0].label).toBe('Before restore');
  });
});

describe('assets', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a8b8a8f50000000049454e44ae426082', 'hex');
  const sha = createHash('sha256').update(png).digest('hex');

  it('stores images by content hash and only shows them to project members', async () => {
    const a = await signup('Images');
    const b = await signup('Other');
    const put = (who: typeof a, body: Buffer, type: string, id = sha) => who.call('PUT', `/api/projects/${a.projectId}/assets/${id}?width=1&height=1`, body, { 'content-type': type });
    expect((await put(a, png, 'image/png')).status).toBe(201);
    expect((await put(a, png, 'image/png', 'f'.repeat(64))).status).toBe(400);
    expect((await put(a, Buffer.from('<svg/>'), 'image/png')).status).toBe(415);
    expect((await put(b, png, 'image/png')).status).toBe(404);
    const got = await a.call('GET', `/api/assets/${sha}`);
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body as Buffer, png)).toBe(0);
    expect((await b.call('GET', `/api/assets/${sha}`)).status).toBe(404);
  });

  it('moving a file to another project brings its images along', async () => {
    const a = await signup('Mover');
    const other = (await a.call('POST', '/api/projects', { name: 'Second' })).body.project.id;
    await a.call('PUT', `/api/projects/${a.projectId}/assets/${sha}?width=1&height=1`, png, { 'content-type': 'image/png' });
    const doc = createDocument('With image');
    addNode(doc, createImage({ pageId: doc.pages[0]!.id, assetId: sha, naturalWidth: 1, naturalHeight: 1, width: 1, height: 1 }));
    const id = (await a.call('POST', `/api/projects/${a.projectId}/files`, { document: doc })).body.file.id;
    expect((await a.call('PATCH', `/api/files/${id}`, { projectId: other })).status).toBe(200);
    const { rows } = await db.query('select 1 from assets where project_id = $1 and id = $2', [other, sha]);
    expect(rows).toHaveLength(1);
    expect((await a.call('DELETE', `/api/projects/${a.projectId}`)).status).toBe(204);
    expect((await a.call('GET', `/api/assets/${sha}`)).status).toBe(200);
  });
});
