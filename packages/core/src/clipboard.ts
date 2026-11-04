/**
 * Copy / paste / duplicate. A clipboard payload is a self-contained subtree snapshot that
 * can travel through the system clipboard as JSON, so it is validated before pasting.
 */
import { createId } from './factory';
import { decompose, invert, multiply, transformMatrix, worldMatrix } from './geometry';
import { isContainer, type DesignDocument, type NodeId, type PageId, type SceneNode } from './model';
import { DocumentError, childIdsOf } from './ops';
import { sortByRenderOrder, topMostIds } from './structure';
import { nodeProblem, treeProblem } from './validate';
import type { Point } from './viewport';

export const CLIPBOARD_KIND = 'canvas-studio/nodes';
/** Upper bound on pasted nodes, so a malicious clipboard cannot freeze the editor. */
export const MAX_CLIPBOARD_NODES = 20_000;

/**
 * Deep copy for JSON-shaped node data. Unlike `structuredClone` this also works on Immer
 * drafts (proxies), which is what ops receive inside an editor edit.
 */
const cloneJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: 1;
  /** Top-level copied nodes, bottom-most first. Their `parentId` is null inside the payload. */
  roots: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  /** Page-space position and rotation of each root when it was copied. */
  transforms: Record<NodeId, { x: number; y: number; rotation: number }>;
}

/** Snapshots the given nodes and their descendants. Returns null when nothing is copyable. */
export function copyNodes(doc: DesignDocument, ids: readonly NodeId[]): ClipboardPayload | null {
  const roots = sortByRenderOrder(doc, topMostIds(doc, ids));
  if (roots.length === 0) return null;
  const nodes: Record<NodeId, SceneNode> = {};
  const transforms: ClipboardPayload['transforms'] = {};
  const collect = (id: NodeId) => {
    const node = doc.nodes[id];
    if (!node) return;
    nodes[id] = cloneJson(node);
    if (isContainer(node)) node.childIds.forEach(collect);
  };
  for (const root of roots) {
    collect(root);
    nodes[root]!.parentId = null;
    transforms[root] = decompose(worldMatrix(doc, root));
  }
  return { kind: CLIPBOARD_KIND, version: 1, roots, nodes, transforms };
}

/** Parses and validates untrusted clipboard text. Returns null if it is not a valid payload. */
export function parseClipboard(text: string): ClipboardPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const p = value as Partial<ClipboardPayload>;
  if (p.kind !== CLIPBOARD_KIND || p.version !== 1) return null;
  if (!Array.isArray(p.roots) || !p.roots.every((r) => typeof r === 'string')) return null;
  if (!p.nodes || typeof p.nodes !== 'object' || !p.transforms || typeof p.transforms !== 'object') return null;
  const entries = Object.entries(p.nodes);
  if (entries.length === 0 || entries.length > MAX_CLIPBOARD_NODES) return null;
  for (const [key, node] of entries) {
    if (nodeProblem(node) !== null || (node as SceneNode).id !== key) return null;
  }
  const seen = new Set<string>();
  if (treeProblem(p.nodes, p.roots, undefined, seen) !== null || seen.size !== entries.length) return null;
  for (const root of p.roots) {
    const t = p.transforms[root];
    if (!t || ![t.x, t.y, t.rotation].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  }
  // Drop any keys the editor does not know about, so foreign data is never saved.
  for (const [key, node] of Object.entries(p.nodes)) p.nodes[key] = pickKnownKeys(node);
  return p as ClipboardPayload;
}

const BASE_KEYS = [
  'id', 'type', 'name', 'pageId', 'parentId', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'visible', 'locked',
  'isMask', 'fills', 'strokes', 'effects', 'constraints', 'sizing', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'componentNodeId', 'overrides', 'bindings', 'interactions',
];
const FRAME_KEYS = ['childIds', 'cornerRadius', 'clipContent', 'layout', 'variableModes', 'scroll'];
const TYPE_KEYS: Record<SceneNode['type'], string[]> = {
  frame: FRAME_KEYS,
  component: [...FRAME_KEYS, 'description', 'variantProps'],
  'component-set': FRAME_KEYS,
  instance: [...FRAME_KEYS, 'componentId'],
  group: ['childIds'],
  rectangle: ['cornerRadius'],
  ellipse: [],
  polygon: ['pointCount'],
  star: ['pointCount', 'innerRadius'],
  line: ['startCap', 'endCap'],
  vector: ['vertices', 'closed'],
  text: ['characters', 'fontFamily', 'fontSize', 'fontWeight', 'italic', 'textAlign', 'lineHeight', 'letterSpacing', 'textDecoration', 'autoResize'],
  image: ['assetId', 'naturalWidth', 'naturalHeight', 'fit', 'crop', 'cornerRadius'],
};

function pickKnownKeys(node: SceneNode): SceneNode {
  const out: Record<string, unknown> = {};
  const src = node as unknown as Record<string, unknown>;
  for (const k of [...BASE_KEYS, ...TYPE_KEYS[node.type]]) if (src[k] !== undefined) out[k] = src[k];
  return out as unknown as SceneNode;
}

export interface PasteTarget {
  pageId: PageId;
  parentId: NodeId | null;
  /** Insert position among the parent's children (default: on top). */
  index?: number;
  /** Page-space offset added to every root's copied position. */
  offset?: Point;
}

/** Inserts a copy of the payload with fresh ids. Returns the new root ids, bottom-most first. */
export function pasteNodes(doc: DesignDocument, payload: ClipboardPayload, target: PasteTarget): NodeId[] {
  const siblings = childIdsOf(doc, target.pageId, target.parentId);
  if (target.parentId) {
    const parent = doc.nodes[target.parentId];
    if (!parent || parent.pageId !== target.pageId) throw new DocumentError('Paste target is not on this page');
  }
  const idMap = new Map<NodeId, NodeId>(Object.keys(payload.nodes).map((id) => [id, createId()]));
  const mapId = (id: NodeId) => idMap.get(id)!;

  for (const [oldId, original] of Object.entries(payload.nodes)) {
    const node = cloneJson(original);
    node.id = mapId(oldId);
    node.pageId = target.pageId;
    node.parentId = original.parentId === null ? target.parentId : mapId(original.parentId);
    if (isContainer(node)) node.childIds = node.childIds.map(mapId);
    doc.nodes[node.id] = node;
  }

  const toParent = invert(target.parentId ? worldMatrix(doc, target.parentId) : [1, 0, 0, 1, 0, 0]);
  const offset = target.offset ?? { x: 0, y: 0 };
  const newRoots = payload.roots.map(mapId);
  payload.roots.forEach((oldRoot, i) => {
    const t = payload.transforms[oldRoot]!;
    const local = decompose(multiply(toParent, transformMatrix(t.x + offset.x, t.y + offset.y, t.rotation)));
    Object.assign(doc.nodes[newRoots[i]!]!, local);
  });
  const at = target.index === undefined ? siblings.length : Math.max(0, Math.min(target.index, siblings.length));
  siblings.splice(at, 0, ...newRoots);
  return newRoots;
}

/** Duplicates each node right above itself in the same parent. Returns the copies' ids. */
export function duplicateNodes(doc: DesignDocument, ids: readonly NodeId[], offset: Point = { x: 0, y: 0 }): NodeId[] {
  const created: NodeId[] = [];
  for (const id of sortByRenderOrder(doc, topMostIds(doc, ids))) {
    const node = doc.nodes[id]!;
    const payload = copyNodes(doc, [id])!;
    const index = childIdsOf(doc, node.pageId, node.parentId).indexOf(id) + 1;
    created.push(...pasteNodes(doc, payload, { pageId: node.pageId, parentId: node.parentId, index, offset }));
  }
  return created;
}
