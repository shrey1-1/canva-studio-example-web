/**
 * The API every tool uses, built-in or sandboxed. Each method checks the tool's declared
 * permissions before touching the document, validates its input, and records all edits of one
 * run as a single undo step.
 */
import Konva from 'konva';
import {
  addNode,
  copyNodes,
  createId,
  createImage,
  deleteNodes,
  DocumentError,
  instanceAncestor,
  isContainer,
  nodeProblem,
  nodeFromSpec,
  pasteNodes,
  updateNode,
  type DesignDocument,
  type NodeId,
  type NodePatch,
  type PluginPermission,
  type Pixels,
  type SceneNode,
  type ToolManifest,
} from '@canvas-studio/core';
import { importImage } from '../../persistence/assetStore';
import { useEditor } from '../../state/editorStore';
import { useToasts } from '../../state/toastStore';
import { rectCenter, visibleWorldRect } from '../placement';
import { downloadFile, pixelsToPng, readAssetPixels } from './imageIO';

export class PermissionError extends Error {
  override name = 'PermissionError';
}

/** Upper bound on layers one run may create, so a broken tool cannot freeze the editor. */
export const MAX_NODES_PER_RUN = 5000;

/** Per-run budgets so one run cannot exhaust the editor's memory. */
export const MAX_IMAGES_PER_RUN = 50;
export const MAX_VERTICES_PER_RUN = 200_000;
export const MAX_TEXT_PER_RUN = 2_000_000;
const MAX_PAINTS = 50;

/** Fields a tool may never patch: structure, component links, variable links and asset references. */
const PROTECTED = new Set([
  'id', 'type', 'pageId', 'parentId', 'childIds', 'componentNodeId', 'overrides', 'componentId',
  'bindings', 'variableModes', 'assetId', '__proto__', 'constructor', 'prototype',
]);
/** File types a tool may save, keyed by extension (the MIME type is derived, never taken from the tool). */
const DOWNLOAD_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  json: 'application/json',
  txt: 'text/plain',
  css: 'text/css',
  csv: 'text/csv',
  md: 'text/markdown',
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Returns a safe "name.ext" with an allowed extension and its MIME type, or throws. */
export function safeDownloadName(name: string): { filename: string; mime: string } {
  const match = /^(.*)\.([A-Za-z0-9]+)$/.exec(String(name).trim());
  const ext = match?.[2]?.toLowerCase() ?? '';
  const mime = DOWNLOAD_TYPES[ext];
  if (!match || !mime) throw new DocumentError(`Tools can only save ${Object.keys(DOWNLOAD_TYPES).map((e) => '.' + e).join(', ')} files`);
  const base = match[1]!.replace(/[^\p{L}\p{N} _().-]+/gu, '-').replace(/^[.\s]+/, '').slice(0, 100) || 'download';
  return { filename: `${base}.${ext}`, mime };
}

export class ToolContext {
  readonly runId = createId();
  private created = 0;
  private images = 0;
  private vertices = 0;
  private text = 0;
  private closed = false;
  readonly createdIds: NodeId[] = [];

  constructor(readonly manifest: ToolManifest) {}

  private require(permission: PluginPermission) {
    if (!this.manifest.permissions.includes(permission)) {
      throw new PermissionError(`"${this.manifest.name}" does not have the "${permission}" permission.`);
    }
  }

  /** Called when a run ends; late async calls (e.g. an image still encoding) can no longer edit. */
  close() {
    this.closed = true;
  }

  private get untrusted() {
    return this.manifest.source !== 'built-in';
  }

  /** Charges vector points / characters against the run's budget. */
  private charge(node: { type: string; vertices?: unknown[]; characters?: string }) {
    if (node.type === 'vector') this.vertices += node.vertices?.length ?? 0;
    if (node.type === 'text') this.text += node.characters?.length ?? 0;
    if (this.vertices > MAX_VERTICES_PER_RUN) throw new DocumentError(`A tool run may create at most ${MAX_VERTICES_PER_RUN} vector points`);
    if (this.text > MAX_TEXT_PER_RUN) throw new DocumentError(`A tool run may write at most ${MAX_TEXT_PER_RUN} characters`);
  }

  /** read-selection tools may only read the selection and what is inside it. */
  private requireReadable(id: NodeId) {
    if (this.manifest.permissions.includes('read-document')) return;
    this.require('read-selection');
    const { doc, selection } = useEditor.getState();
    for (let cur: NodeId | null = id, depth = 0; cur && depth < 300; cur = doc.nodes[cur]?.parentId ?? null, depth++) {
      if (selection.includes(cur)) return;
    }
    throw new PermissionError(`"${this.manifest.name}" can only read the selected layers.`);
  }

  /** All edits of a run merge into one undo step. */
  private edit(recipe: (d: DesignDocument) => void) {
    if (this.closed) throw new DocumentError('This tool run has ended');
    useEditor.getState().dispatch(`Run ${this.manifest.name}`, recipe, { coalesceKey: `tool:${this.runId}`, mergeWindowMs: Infinity });
  }

  private editableParent(d: DesignDocument, parentId: NodeId | null | undefined): NodeId | null {
    if (!parentId) return null;
    const p = d.nodes[parentId];
    if (!p || !isContainer(p) || p.pageId !== useEditor.getState().activePageId) throw new DocumentError('Parent not found on this page');
    if (instanceAncestor(d, parentId)) throw new DocumentError('Cannot add layers inside an instance');
    return parentId;
  }

  // ----- Reading -----

  getSelection(): SceneNode[] {
    this.require('read-selection');
    const { doc, selection } = useEditor.getState();
    return selection.map((id) => doc.nodes[id]).filter((n): n is SceneNode => !!n).map(clone);
  }

  /** A layer and its descendants (only within the selection's reach for read-selection tools). */
  getNode(id: NodeId): SceneNode | null {
    this.requireReadable(id);
    const node = useEditor.getState().doc.nodes[id];
    return node ? clone(node) : null;
  }

  getDocument(): Pick<DesignDocument, 'name' | 'pages' | 'nodes' | 'variableCollections' | 'variables'> & { activePageId: string } {
    this.require('read-document');
    const { doc, activePageId } = useEditor.getState();
    return clone({ name: doc.name, pages: doc.pages, nodes: doc.nodes, variableCollections: doc.variableCollections, variables: doc.variables, activePageId });
  }

  async readImage(nodeId: NodeId, maxSide = 1024): Promise<Pixels> {
    this.requireReadable(nodeId);
    const node = useEditor.getState().doc.nodes[nodeId];
    if (!node || node.type !== 'image') throw new DocumentError('That layer is not an image');
    return readAssetPixels(node.assetId, Math.max(16, Math.min(4096, maxSide)));
  }

  viewportCenter() {
    return rectCenter(visibleWorldRect());
  }

  // ----- Writing -----

  /** Creates layers from specs. A spec may name a parent created earlier in the same call by its index ("#0"). */
  createNodes(specs: unknown[], parentId: NodeId | null = null): NodeId[] {
    this.require('create-nodes');
    if (!Array.isArray(specs)) throw new DocumentError('createNodes expects an array');
    if (this.created + specs.length > MAX_NODES_PER_RUN) throw new DocumentError(`A tool run may create at most ${MAX_NODES_PER_RUN} layers`);
    const ids: NodeId[] = [];
    this.edit((d) => {
      const pageId = useEditor.getState().activePageId;
      specs.forEach((spec) => {
        const s = spec as { parent?: unknown };
        let parent = this.editableParent(d, parentId);
        if (typeof s?.parent === 'string' && /^#\d+$/.test(s.parent)) parent = ids[Number(s.parent.slice(1))] ?? parent;
        else if (typeof s?.parent === 'string') parent = this.editableParent(d, s.parent);
        const node = nodeFromSpec(spec, pageId, parent);
        this.charge(node as { type: string });
        addNode(d, node);
        ids.push(node.id);
      });
    });
    this.created += ids.length;
    this.createdIds.push(...ids);
    return ids;
  }

  updateNodes(patches: unknown[]): void {
    this.require('modify-nodes');
    if (!Array.isArray(patches)) throw new DocumentError('updateNodes expects an array');
    this.edit((d) => {
      for (const raw of patches) {
        if (!raw || typeof raw !== 'object') throw new DocumentError('Each update must be an object with an id');
        const { id, ...rest } = raw as Record<string, unknown>;
        const node = typeof id === 'string' ? d.nodes[id] : undefined;
        if (!node || node.pageId !== useEditor.getState().activePageId) throw new DocumentError('Layer not found on this page');
        // Only existing, non-protected fields; anything else is ignored.
        const patch = clone(Object.fromEntries(Object.entries(rest).filter(([k]) => !PROTECTED.has(k) && Object.hasOwn(node, k))));
        for (const k of ['fills', 'strokes', 'effects']) {
          if (Array.isArray(patch[k]) && (patch[k] as unknown[]).length > MAX_PAINTS) throw new DocumentError(`At most ${MAX_PAINTS} ${k} per layer`);
        }
        if (typeof patch.name === 'string') patch.name = patch.name.slice(0, 200);
        // The patched layer must still be a valid layer, or the file could not be reopened.
        const problem = nodeProblem({ ...clone(node), ...patch });
        if (problem) throw new DocumentError(`Invalid update (${problem.replace(/^node \S+: /, '')})`);
        this.charge({ type: node.type, vertices: patch.vertices as unknown[] | undefined, characters: patch.characters as string | undefined });
        updateNode(d, node.id, patch as NodePatch);
      }
    });
  }

  deleteNodes(ids: unknown[]): void {
    this.require('modify-nodes');
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) throw new DocumentError('deleteNodes expects an array of ids');
    this.edit((d) => deleteNodes(d, (ids as string[]).filter((id) => d.nodes[id]?.pageId === useEditor.getState().activePageId)));
  }

  /** Copies an existing layer (with its children) into a parent; returns the copy's id. */
  copyInto(sourceId: NodeId, parentId: NodeId | null, at: { x: number; y: number }): NodeId {
    this.require('read-selection');
    this.require('create-nodes');
    let id = '';
    this.edit((d) => {
      const payload = copyNodes(d, [sourceId]);
      if (!payload) throw new DocumentError('Layer not found');
      const parent = this.editableParent(d, parentId);
      [id] = pasteNodes(d, payload, { pageId: useEditor.getState().activePageId, parentId: parent }) as [string];
      const n = d.nodes[id]!;
      n.x = at.x;
      n.y = at.y;
      n.rotation = 0;
    });
    this.createdIds.push(id);
    return id;
  }

  /** Low-level edit for first-party tools that need ops beyond specs (still permission-checked). */
  editDocument(permission: PluginPermission, recipe: (d: DesignDocument) => void) {
    this.require(permission);
    this.edit(recipe);
  }

  /** Places generated pixels (or an image file) as an image layer. */
  async placeImage(
    source: Pixels | File,
    opts: { name?: string; x?: number; y?: number; width?: number; height?: number; parentId?: NodeId | null } = {},
  ): Promise<NodeId> {
    this.require('create-nodes');
    if (this.untrusted) this.require('import-assets');
    if (this.closed) throw new DocumentError('This tool run has ended');
    if (++this.images > MAX_IMAGES_PER_RUN) throw new DocumentError(`A tool run may add at most ${MAX_IMAGES_PER_RUN} images`);
    const file = source instanceof File ? source : await pixelsToPng(source, `${opts.name ?? 'Generated'}.png`);
    const img = await importImage(file);
    const c = this.viewportCenter();
    const width = opts.width ?? img.width;
    const height = opts.height ?? img.height;
    let id = '';
    this.edit((d) => {
      const node = createImage({
        pageId: useEditor.getState().activePageId,
        parentId: this.editableParent(d, opts.parentId ?? null),
        x: Math.round(opts.x ?? c.x - width / 2),
        y: Math.round(opts.y ?? c.y - height / 2),
        width,
        height,
        name: opts.name ?? img.name,
        assetId: img.assetId,
        naturalWidth: img.width,
        naturalHeight: img.height,
      });
      addNode(d, node);
      id = node.id;
    });
    this.createdIds.push(id);
    return id;
  }

  download(name: string, content: string | Blob, mime = 'text/plain'): void {
    this.require('export');
    if (typeof content === 'string' && content.length > 50_000_000) throw new DocumentError('Export is too large');
    if (!this.untrusted) return downloadFile(String(name), content, mime);
    // Custom tools: allowed file types only, and the user confirms each file with a click.
    const safe = safeDownloadName(name);
    useToasts.getState().push(`${this.manifest.name} wants to save "${safe.filename}".`, 'info', {
      action: { label: 'Save', run: () => downloadFile(safe.filename, content, safe.mime) },
      durationMs: 30_000,
    });
  }

  /** Renders a layer as it appears on the canvas to a PNG (2x). */
  async exportNodePng(id: NodeId): Promise<Blob> {
    this.require('export');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const stage = Konva.stages[0];
    const node = stage?.findOne(`#${id}`);
    if (!node) throw new DocumentError('That layer is not on the visible page');
    const zoom = useEditor.getState().viewport.zoom;
    const url = node.toDataURL({ pixelRatio: 2 / zoom, mimeType: 'image/png' });
    return (await fetch(url)).blob();
  }

  /** Renders a layer to a PNG data URL for in-app previews (players); nothing leaves the app. */
  async snapshot(id: NodeId, pixelRatio = 1): Promise<string> {
    if (!this.manifest.permissions.includes('read-document')) this.require('read-selection');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const node = Konva.stages[0]?.findOne(`#${id}`);
    if (!node) throw new DocumentError('That layer is not on the visible page');
    return node.toDataURL({ pixelRatio: pixelRatio / useEditor.getState().viewport.zoom, mimeType: 'image/png' });
  }

  notify(message: string): void {
    // Custom tools' messages carry the tool's name so they cannot pose as the app.
    const text = String(message).slice(0, 300);
    useToasts.getState().push(this.untrusted ? `${this.manifest.name}: ${text}` : text);
  }

  select(ids: NodeId[]): void {
    useEditor.getState().select(ids.filter((id) => typeof id === 'string'));
  }
}
