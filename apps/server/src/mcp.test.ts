import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildApp, CSRF_HEADER, CSRF_VALUE } from './app';
import { migrate, openPglite, type Db } from './db';
import { CanvasApi, createServer } from './mcp';

let db: Db;
let app: FastifyInstance;
let origin = '';

beforeAll(async () => {
  db = await openPglite();
  await migrate(db);
  app = await buildApp({ db, authAttempts: 1000 });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60_000);
afterAll(async () => {
  await app.close();
  await db.close();
});

async function agent(scopes: 'read' | 'write') {
  const res = await app.inject({ method: 'POST', url: '/api/auth/signup', headers: { [CSRF_HEADER]: CSRF_VALUE }, payload: { email: `mcp-${Math.random()}@example.com`, name: 'Agent owner', password: 'correct horse' } });
  const cookie = `cs_session=${res.cookies.find((c) => c.name === 'cs_session')!.value}`;
  const headers = { cookie, [CSRF_HEADER]: CSRF_VALUE };
  const projectId = (await app.inject({ method: 'GET', url: '/api/projects', headers })).json().projects[0].id;
  const fileId = (await app.inject({ method: 'POST', url: `/api/projects/${projectId}/files`, headers, payload: { name: 'Agent file' } })).json().file.id;
  const secret = (await app.inject({ method: 'POST', url: '/api/tokens', headers, payload: { name: 'Test agent', scopes } })).json().secret;
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(new CanvasApi(origin, secret)).connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
    return { error: r.isError === true, text: r.content[0]!.text };
  };
  return { client, call, fileId };
}

describe('MCP server', () => {
  it('lists its tools and lets an agent build and inspect a design', async () => {
    const { client, call, fileId } = await agent('write');
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['list_files', 'get_file_outline', 'create_nodes', 'update_nodes', 'delete_nodes', 'export_svg', 'add_comment']));

    const created = JSON.parse((await call('create_nodes', {
      fileId,
      specs: [
        { type: 'frame', name: 'Card', x: 0, y: 0, width: 320, height: 200, fill: '#FFFFFF' },
        { type: 'text', name: 'Title', parent: '#0', x: 16, y: 16, characters: 'Hello agents', fontSize: 24 },
      ],
    })).text).created as string[];
    expect(created).toHaveLength(2);
    expect((await call('get_file_outline', { fileId })).text).toMatch(/frame "Card".*\n\s+text "Title"/);

    expect((await call('update_nodes', { fileId, updates: [{ id: created[0], name: 'Hero card', parentId: 'evil' }] })).error).toBe(false);
    const [card] = JSON.parse((await call('get_nodes', { fileId, ids: [created[0]] })).text);
    expect(card).toMatchObject({ name: 'Hero card', parentId: null });
    expect((await call('update_nodes', { fileId, updates: [{ id: created[0], fills: 'nope' }] })).error).toBe(true);

    expect((await call('export_svg', { fileId, ids: [created[0]] })).text).toContain('Hello agents');
    expect((await call('add_comment', { fileId, body: 'Agent review: looks good', pageId: 'p', x: 1, y: 2 })).error).toBe(false);
    await call('delete_nodes', { fileId, ids: [created[0]] });
    expect((await call('get_file_outline', { fileId })).text).not.toContain('Hero card');
  });

  it('read-only tokens cannot edit', async () => {
    const { call, fileId } = await agent('read');
    const r = await call('create_nodes', { fileId, specs: [{ type: 'rectangle', width: 10, height: 10 }] });
    expect(r).toEqual({ error: true, text: 'This token is read-only.' });
    expect((await call('list_files')).error).toBe(false);
  });
});
