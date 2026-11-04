/**
 * Pure document operations. They mutate the document passed in, which makes them
 * usable inside an Immer `produce` recipe (the editor's undo history records the
 * resulting patches) and equally usable on a plain object on the server.
 * They throw `DocumentError` on invalid input instead of silently corrupting data.
 *
 * Ops deliberately do not touch `updatedAt`: a no-op edit must produce no undo entry.
 * The persistence layer stamps `updatedAt` when it saves.
 */
import { createPage } from './factory';
import { containsPoint, worldMatrix } from './geometry';
import { isContainer, type DesignDocument, type NodeId, type Page, type PageId, type SceneNode } from './model';

export class DocumentError extends Error {
  override name = 'DocumentError';
}

export function getPage(doc: DesignDocument, pageId: PageId): Page {
  const page = doc.pages.find((p) => p.id === pageId);
  if (!page) throw new DocumentError(`Page not found: ${pageId}`);
  return page;
}

export function getNode(doc: DesignDocument, id: NodeId): SceneNode {
  const node = doc.nodes[id];
  if (!node) throw new DocumentError(`Node not found: ${id}`);
  return node;
}

/** Ordered child ids of a container node, or of the page when `parentId` is null. */
export function childIdsOf(doc: DesignDocument, pageId: PageId, parentId: NodeId | null): NodeId[] {
  if (parentId === null) return getPage(doc, pageId).childIds;
  const parent = getNode(doc, parentId);
  if (!isContainer(parent)) throw new DocumentError(`Node ${parentId} cannot contain children`);
  return parent.childIds;
}

export function isAncestor(doc: DesignDocument, ancestorId: NodeId, id: NodeId): boolean {
  let current = doc.nodes[id]?.parentId ?? null;
  while (current) {
    if (current === ancestorId) return true;
    current = doc.nodes[current]?.parentId ?? null;
  }
  return false;
}

/**
 * The instance a node belongs to: the node itself when it is an instance, or the nearest
 * instance ancestor. Layers inside an instance mirror the main component, so their structure
 * (adding, removing, moving, reordering children) cannot be changed directly.
 */
export function instanceAncestor(doc: DesignDocument, id: NodeId | null, includeSelf = true): NodeId | null {
  let current = id ? doc.nodes[id] : undefined;
  if (current && !includeSelf) current = current.parentId ? doc.nodes[current.parentId] : undefined;
  while (current) {
    if (current.type === 'instance') return current.id;
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return null;
}

/** True when `id` is a layer inside an instance (not the instance itself). */
export const isInsideInstance = (doc: DesignDocument, id: NodeId) => instanceAncestor(doc, id, false) !== null;

export const INSTANCE_STRUCTURE_ERROR = 'Layers inside an instance cannot be added, moved or deleted. Edit the main component or detach the instance.';

/** Adds a node to its page/parent at `index` (default: on top). */
export function addNode(doc: DesignDocument, node: SceneNode, index?: number): void {
  if (doc.nodes[node.id]) throw new DocumentError(`Duplicate node id: ${node.id}`);
  if (node.parentId && instanceAncestor(doc, node.parentId)) throw new DocumentError(INSTANCE_STRUCTURE_ERROR);
  const siblings = childIdsOf(doc, node.pageId, node.parentId);
  if (node.parentId && doc.nodes[node.parentId]?.pageId !== node.pageId) {
    throw new DocumentError('Parent is on a different page');
  }
  doc.nodes[node.id] = node;
  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  siblings.splice(at, 0, node.id);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type StructuralKey = 'id' | 'type' | 'pageId' | 'parentId' | 'childIds';
/** Editable properties of any node type. Structural fields change via move/group ops. */
export type NodePatch = Partial<DistributiveOmit<SceneNode, StructuralKey>>;

const inRange = (v: unknown, min: number, max: number) => typeof v === 'number' && v >= min && v <= max;

/** Shallow-updates editable properties after validating them. */
export function updateNode(doc: DesignDocument, id: NodeId, patch: NodePatch): void {
  const node = getNode(doc, id);
  const p = patch as Record<string, unknown>;
  for (const key of ['id', 'type', 'pageId', 'parentId', 'childIds'] as const) {
    if (key in p) throw new DocumentError(`Cannot change "${key}" with updateNode`);
  }
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'cornerRadius', 'fontSize', 'letterSpacing', 'lineHeight'] as const) {
    if (key in p && !Number.isFinite(p[key])) throw new DocumentError(`${key} must be a finite number`);
  }
  if ('width' in p && !((p.width as number) >= 0)) throw new DocumentError('Width must be >= 0');
  if ('height' in p && !((p.height as number) >= 0)) throw new DocumentError('Height must be >= 0');
  if ('opacity' in p && !inRange(p.opacity, 0, 1)) throw new DocumentError('Opacity must be between 0 and 1');
  if ('fontSize' in p && !inRange(p.fontSize, 1, 2000)) throw new DocumentError('Font size must be between 1 and 2000');
  if ('fontWeight' in p && !inRange(p.fontWeight, 100, 900)) throw new DocumentError('Font weight must be 100..900');
  if ('lineHeight' in p && !inRange(p.lineHeight, 0.1, 10)) throw new DocumentError('Line height must be 0.1..10');
  if ('pointCount' in p && !inRange(p.pointCount, 3, 60)) throw new DocumentError('Point count must be 3..60');
  if ('innerRadius' in p && !inRange(p.innerRadius, 0.01, 1)) throw new DocumentError('Inner radius must be 0.01..1');
  if ('crop' in p) {
    const c = p.crop as { x: number; y: number; width: number; height: number };
    const ok =
      inRange(c?.x, 0, 1) && inRange(c?.y, 0, 1) && inRange(c?.width, 0.001, 1) && inRange(c?.height, 0.001, 1) &&
      c.x + c.width <= 1.000001 && c.y + c.height <= 1.000001;
    if (!ok) throw new DocumentError('Crop must stay inside the image');
  }
  if (node.type === 'line' && 'height' in p && p.height !== 0) throw new DocumentError('A line has no height');
  for (const key of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) {
    if (key in p && p[key] !== null && !(Number.isFinite(p[key]) && (p[key] as number) >= 0)) {
      throw new DocumentError(`${key} must be empty or a number >= 0`);
    }
  }
  trackOverrides(node, Object.keys(p));
  Object.assign(node, patch);
}

/** Keys that never count as instance overrides (they belong to the instance's placement). */
const PLACEMENT_KEYS = new Set(['x', 'y', 'rotation', 'name', 'locked', 'constraints', 'sizing', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'isMask']);

/** Records which properties of an instance (or a layer inside one) were changed locally. */
export function trackOverrides(node: SceneNode, keys: readonly string[]): void {
  const inInstance = node.type === 'instance' || node.componentNodeId !== undefined;
  if (!inInstance) return;
  const isRoot = node.type === 'instance';
  const relevant = keys.filter((k) => k !== 'overrides' && k !== 'componentId' && (!isRoot || !PLACEMENT_KEYS.has(k)));
  // x/y of layers inside an instance are overrides too (they are not the instance's own placement).
  if (relevant.length === 0) return;
  const current = new Set(node.overrides ?? []);
  const before = current.size;
  relevant.forEach((k) => current.add(k));
  if (current.size !== before) node.overrides = [...current];
}

/** Deletes nodes and all their descendants. Unknown ids are ignored. */
export function deleteNodes(doc: DesignDocument, ids: readonly NodeId[]): void {
  for (const id of ids) {
    const owner = doc.nodes[id] ? instanceAncestor(doc, id, false) : null;
    if (owner && !ids.includes(owner) && !ids.some((other) => other !== id && isAncestor(doc, other, owner))) {
      throw new DocumentError(INSTANCE_STRUCTURE_ERROR);
    }
  }
  const toDelete = new Set<NodeId>();
  const collect = (id: NodeId) => {
    const node = doc.nodes[id];
    if (!node || toDelete.has(id)) return;
    toDelete.add(id);
    if (isContainer(node)) node.childIds.forEach(collect);
  };
  ids.forEach(collect);
  if (toDelete.size === 0) return;

  for (const id of toDelete) {
    const node = doc.nodes[id];
    if (!node) continue;
    // Detach from a parent that is not itself being deleted.
    if (!node.parentId || !toDelete.has(node.parentId)) {
      const siblings = childIdsOf(doc, node.pageId, node.parentId);
      const i = siblings.indexOf(id);
      if (i >= 0) siblings.splice(i, 1);
    }
  }
  for (const id of toDelete) delete doc.nodes[id];
}

export function addPage(doc: DesignDocument, name?: string): Page {
  const page = createPage(name ?? nextPageName(doc));
  doc.pages.push(page);
  return page;
}

export function renamePage(doc: DesignDocument, pageId: PageId, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new DocumentError('Page name cannot be empty');
  getPage(doc, pageId).name = trimmed;
}

export function updatePage(doc: DesignDocument, pageId: PageId, patch: Partial<Pick<Page, 'background'>>): void {
  Object.assign(getPage(doc, pageId), patch);
}

/** Sets (or clears, with null) the screen a page's prototype starts on. */
export function setFlowStart(doc: DesignDocument, pageId: PageId, nodeId: NodeId | null): void {
  const page = getPage(doc, pageId);
  if (nodeId === null) {
    delete page.flowStartId;
    return;
  }
  const node = doc.nodes[nodeId];
  if (!node || node.pageId !== pageId || node.parentId !== null) throw new DocumentError('A flow must start on a top-level frame of this page');
  page.flowStartId = nodeId;
}

/** Deletes a page and every node on it. A document always keeps at least one page. */
export function deletePage(doc: DesignDocument, pageId: PageId): void {
  if (doc.pages.length <= 1) throw new DocumentError('A document must have at least one page');
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index < 0) throw new DocumentError(`Page not found: ${pageId}`);
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.pageId === pageId) delete doc.nodes[id];
  }
  doc.pages.splice(index, 1);
}

export function renameDocument(doc: DesignDocument, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new DocumentError('Document name cannot be empty');
  doc.name = trimmed;
}

/** Page-space position of a node's origin (its rotated top-left corner). */
export function absolutePosition(doc: DesignDocument, id: NodeId): { x: number; y: number } {
  getNode(doc, id);
  const m = worldMatrix(doc, id);
  return { x: m[4], y: m[5] };
}

/**
 * Deepest visible, unlocked frame on the page whose (possibly rotated) box contains the page-space
 * point. Frames in `exclude` and their descendants are skipped (e.g. the nodes being dragged).
 */
export function frameAtPoint(
  doc: DesignDocument,
  pageId: PageId,
  px: number,
  py: number,
  exclude: ReadonlySet<NodeId> = new Set(),
): NodeId | null {
  const search = (ids: readonly NodeId[]): NodeId | null => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const node = doc.nodes[ids[i]!];
      if (!node || !node.visible || node.locked || exclude.has(node.id)) continue;
      // Instances cannot take new children; component sets only hold their variants.
      if (node.type === 'group' || node.type === 'component-set') {
        const inside = search(node.childIds);
        if (inside) return inside;
        continue;
      }
      if (node.type !== 'frame' && node.type !== 'component') continue;
      if (containsPoint(doc, node.id, { x: px, y: py })) return search(node.childIds) ?? node.id;
    }
    return null;
  };
  return search(getPage(doc, pageId).childIds);
}

function nextPageName(doc: DesignDocument): string {
  let n = doc.pages.length + 1;
  const names = new Set(doc.pages.map((p) => p.name));
  while (names.has(`Page ${n}`)) n++;
  return `Page ${n}`;
}
