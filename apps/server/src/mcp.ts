/**
 * Canvas Studio MCP server (stdio) for AI agents.
 *
 * It talks to the Canvas Studio HTTP API with a personal access token (created in the editor's
 * Agents panel), so every call goes through the same permission checks as the app: the token's
 * scope (read / write), its optional project limit, and the user's role in each project.
 *
 * Environment:
 *   CANVAS_STUDIO_TOKEN  required, cs_pat_...
 *   CANVAS_STUDIO_URL    API origin (default http://127.0.0.1:8787)
 * stdout carries the MCP protocol; diagnostics go to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  addNode,
  approximateTextMeasure,
  deleteNodes,
  DocumentError,
  exportSvg,
  finalizeDocument,
  isContainer,
  nodeFromSpec,
  safePatch,
  updateNode,
  type DesignDocument,
  type NodeId,
  type NodePatch,
  type SceneNode,
} from '@canvas-studio/core';

const MAX_SPECS = 1000;
const OUTLINE_LIMIT = 500;

export class CanvasApi {
  constructor(private readonly origin: string, private readonly token: string) {}

  async call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.origin}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
    if (!res.ok) throw new ApiFailure(res.status, typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
    return data as T;
  }

  /** Loads a file, applies `edit`, re-derives layout and saves; retries if someone saved in between. */
  async editFile<T>(fileId: string, edit: (doc: DesignDocument) => T): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const { file } = await this.call<{ file: { document: DesignDocument; revision: number } }>('GET', `/files/${fileId}`);
      const doc = file.document;
      const result = edit(doc);
      finalizeDocument(doc, approximateTextMeasure);
      try {
        await this.call('PUT', `/files/${fileId}`, { document: doc, baseRevision: file.revision });
        return result;
      } catch (e) {
        if (!(e instanceof ApiFailure && e.status === 409) || attempt >= 3) throw e;
      }
    }
  }
}

export class ApiFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });
const safe = <A>(fn: (args: A) => Promise<ReturnType<typeof text>>) => async (args: A) => {
  try {
    return await fn(args);
  } catch (e) {
    return fail(e);
  }
};

/** Compact tree of a page: one line per layer (id, type, name, box). */
export function outline(doc: DesignDocument, pageId?: string): string {
  const lines: string[] = [];
  const walk = (id: NodeId, depth: number) => {
    const n = doc.nodes[id];
    if (!n || lines.length >= OUTLINE_LIMIT) return;
    lines.push(`${'  '.repeat(depth)}${n.type} "${n.name}" id=${n.id} x=${Math.round(n.x)} y=${Math.round(n.y)} w=${Math.round(n.width)} h=${Math.round(n.height)}${n.visible ? '' : ' hidden'}`);
    if ('childIds' in n) for (const c of n.childIds) walk(c, depth + 1);
  };
  for (const page of doc.pages) {
    if (pageId && page.id !== pageId) continue;
    lines.push(`page "${page.name}" id=${page.id}`);
    for (const id of page.childIds) walk(id, 1);
  }
  if (lines.length >= OUTLINE_LIMIT) lines.push(`… truncated at ${OUTLINE_LIMIT} layers; pass pageId or use get_nodes`);
  return lines.join('\n');
}

export function createServer(api: CanvasApi): McpServer {
  const server = new McpServer({ name: 'canvas-studio', version: '0.1.0' });
  const fileId = z.uuid().describe('File id (from list_files)');

  server.registerTool('list_projects', { description: 'Projects this token can access, with your role in each.' }, safe(async () => text(await api.call('GET', '/projects'))));

  server.registerTool(
    'list_files',
    { description: 'Files in a project, or your most recently edited files.', inputSchema: { projectId: z.uuid().optional() } },
    safe(async ({ projectId }) => {
      if (!projectId) return text((await api.call('GET', '/files/recent')).files);
      const { files, folders } = await api.call<{ files: unknown; folders: unknown }>('GET', `/projects/${projectId}`);
      return text({ folders, files });
    }),
  );

  server.registerTool(
    'get_file_outline',
    { description: 'Pages and the layer tree (id, type, name, position, size) of a file.', inputSchema: { fileId, pageId: z.string().optional() } },
    safe(async (a) => {
      const { file } = await api.call<{ file: { document: DesignDocument; role: string; revision: number } }>('GET', `/files/${a.fileId}`);
      return text(`file "${file.document.name}" role=${file.role} revision=${file.revision}\n${outline(file.document, a.pageId)}`);
    }),
  );

  server.registerTool(
    'get_nodes',
    { description: 'Full properties of specific layers.', inputSchema: { fileId, ids: z.array(z.string()).min(1).max(100) } },
    safe(async (a) => {
      const { file } = await api.call<{ file: { document: DesignDocument } }>('GET', `/files/${a.fileId}`);
      return text(a.ids.map((id) => file.document.nodes[id] ?? { id, error: 'not found' }));
    }),
  );

  server.registerTool(
    'create_nodes',
    {
      description:
        'Adds layers from specs: { type: frame|rectangle|ellipse|polygon|star|line|text|vector, name?, x, y, width, height, fill?: "#RRGGBB", stroke?, strokeWidth?, cornerRadius?, opacity?, characters?, fontSize?, fontWeight?, parent?: "#<index of an earlier spec>" | layerId }. Returns the new ids.',
      inputSchema: { fileId, specs: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_SPECS), pageId: z.string().optional(), parentId: z.string().optional() },
    },
    safe(async (a) => {
      const ids = await api.editFile(a.fileId, (doc) => {
        const pageId = a.pageId ?? doc.pages[0]!.id;
        if (!doc.pages.some((p) => p.id === pageId)) throw new DocumentError('Page not found');
        const parentOk = (id: string | undefined) => {
          if (!id) return null;
          const p = doc.nodes[id];
          if (!p || !isContainer(p) || p.pageId !== pageId) throw new DocumentError(`Parent ${id} is not a frame or group on this page`);
          return id;
        };
        const created: NodeId[] = [];
        for (const spec of a.specs) {
          const ref = spec.parent;
          const parent = typeof ref === 'string' && /^#\d+$/.test(ref) ? (created[Number(ref.slice(1))] ?? null) : parentOk(typeof ref === 'string' ? ref : a.parentId);
          const node = nodeFromSpec(spec, pageId, parent);
          addNode(doc, node);
          created.push(node.id);
        }
        return created;
      });
      return text({ created: ids });
    }),
  );

  server.registerTool(
    'update_nodes',
    {
      description: 'Changes properties of existing layers: [{ id, ...fields }]. Structure, component and variable links cannot be changed; the result must be a valid layer.',
      inputSchema: { fileId, updates: z.array(z.record(z.string(), z.unknown())).min(1).max(MAX_SPECS) },
    },
    safe(async (a) => {
      const count = await api.editFile(a.fileId, (doc) => {
        for (const raw of a.updates) {
          const node = typeof raw.id === 'string' ? doc.nodes[raw.id] : undefined;
          if (!node) throw new DocumentError(`Layer ${String(raw.id)} not found`);
          updateNode(doc, node.id, safePatch(node as SceneNode, raw) as NodePatch);
        }
        return a.updates.length;
      });
      return text({ updated: count });
    }),
  );

  server.registerTool(
    'delete_nodes',
    { description: 'Deletes layers (and their children).', inputSchema: { fileId, ids: z.array(z.string()).min(1).max(MAX_SPECS) } },
    safe(async (a) => {
      await api.editFile(a.fileId, (doc) => deleteNodes(doc, a.ids.filter((id) => doc.nodes[id])));
      return text({ deleted: a.ids.length });
    }),
  );

  server.registerTool(
    'export_svg',
    { description: 'SVG markup of layers (images are left out).', inputSchema: { fileId, ids: z.array(z.string()).min(1).max(100) } },
    safe(async (a) => {
      const { file } = await api.call<{ file: { document: DesignDocument } }>('GET', `/files/${a.fileId}`);
      return text(exportSvg(file.document, a.ids) ?? 'Nothing visible to export.');
    }),
  );

  server.registerTool('list_comments', { description: 'Comments and replies on a file.', inputSchema: { fileId } }, safe(async (a) => text((await api.call('GET', `/files/${a.fileId}/comments`)).comments)));

  server.registerTool(
    'add_comment',
    {
      description: 'Adds a comment pinned at a position on a page, or a reply (parentId).',
      inputSchema: { fileId, body: z.string().min(1).max(5000), parentId: z.uuid().optional(), pageId: z.string().optional(), x: z.number().optional(), y: z.number().optional() },
    },
    safe(async ({ fileId: id, ...body }) => text((await api.call('POST', `/files/${id}/comments`, body)).comment)),
  );

  return server;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()!);
if (isMain) {
  const token = process.env.CANVAS_STUDIO_TOKEN;
  if (!token) {
    console.error('Set CANVAS_STUDIO_TOKEN to an access token from the Agents panel.');
    process.exit(1);
  }
  const api = new CanvasApi(process.env.CANVAS_STUDIO_URL ?? 'http://127.0.0.1:8787', token);
  await createServer(api).connect(new StdioServerTransport());
  console.error('Canvas Studio MCP server ready (stdio).');
}
