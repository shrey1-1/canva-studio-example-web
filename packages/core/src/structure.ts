/**
 * Structural operations: moving/reparenting, z-order, grouping, resizing and alignment.
 * All of them keep every node's on-screen (page-space) position unless the operation's
 * purpose is to move it.
 */
import { createFrame, createGroup } from './factory';
import {
  applyLinear,
  applyMatrix,
  boundsOfPoints,
  boxCorners,
  decompose,
  invert,
  localMatrix,
  multiply,
  nodeBounds,
  parentWorldMatrix,
  round,
  selectionBounds,
  worldMatrix,
  type Matrix,
} from './geometry';
import { isContainer, type DesignDocument, type GroupNode, type NodeId, type PageId, type SceneNode } from './model';
import { DocumentError, INSTANCE_STRUCTURE_ERROR, addNode, childIdsOf, getNode, getPage, instanceAncestor, isAncestor, isInsideInstance, trackOverrides } from './ops';
import type { Point } from './viewport';

/** Removes unknown ids and ids whose ancestor is also listed (moving a parent moves its children). */
export function topMostIds(doc: DesignDocument, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids.filter((id) => doc.nodes[id]));
  return [...set].filter((id) => ![...set].some((other) => other !== id && isAncestor(doc, other, id)));
}

/** Position of a node in the tree as a list of sibling indexes, from the page down. */
function treePath(doc: DesignDocument, id: NodeId): number[] {
  const path: number[] = [];
  let node = doc.nodes[id];
  while (node) {
    path.unshift(childIdsOf(doc, node.pageId, node.parentId).indexOf(node.id));
    node = node.parentId ? doc.nodes[node.parentId] : undefined;
  }
  const pageIndex = doc.pages.findIndex((p) => p.id === doc.nodes[id]?.pageId);
  return [pageIndex, ...path];
}

/** Sorts ids in render order (bottom-most first, parents before children). */
export function sortByRenderOrder(doc: DesignDocument, ids: readonly NodeId[]): NodeId[] {
  const keyed = ids.filter((id) => doc.nodes[id]).map((id) => ({ id, path: treePath(doc, id) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
      if (a.path[i] !== b.path[i]) return a.path[i]! - b.path[i]!;
    }
    return a.path.length - b.path.length;
  });
  return keyed.map((k) => k.id);
}

export interface MoveTarget {
  pageId: PageId;
  /** `null` = top level of the page. */
  parentId: NodeId | null;
  /** Index among the target's children *after* the moved nodes are taken out. Default: on top. */
  index?: number;
}

function setPageRecursive(doc: DesignDocument, id: NodeId, pageId: PageId) {
  const node = doc.nodes[id];
  if (!node) return;
  node.pageId = pageId;
  if (isContainer(node)) node.childIds.forEach((c) => setPageRecursive(doc, c, pageId));
}

function assignTransform(node: SceneNode, m: Matrix) {
  const { x, y, rotation } = decompose(m);
  node.x = x;
  node.y = y;
  node.rotation = rotation;
}

/**
 * Moves nodes (with their subtrees) into a new parent and/or position in the stack,
 * preserving their page-space position and rotation. Order among the moved nodes is kept.
 */
export function moveNodes(doc: DesignDocument, ids: readonly NodeId[], target: MoveTarget): void {
  const moving = sortByRenderOrder(doc, topMostIds(doc, ids));
  if (moving.length === 0) return;
  getPage(doc, target.pageId);
  if (moving.some((id) => isInsideInstance(doc, id)) || (target.parentId && instanceAncestor(doc, target.parentId))) {
    throw new DocumentError(INSTANCE_STRUCTURE_ERROR);
  }
  if (target.parentId !== null) {
    const parent = getNode(doc, target.parentId);
    if (!isContainer(parent)) throw new DocumentError('Target cannot contain layers');
    if (parent.pageId !== target.pageId) throw new DocumentError('Target parent is on a different page');
    if (moving.some((id) => id === target.parentId || isAncestor(doc, id, target.parentId!))) {
      throw new DocumentError('Cannot move a layer into itself');
    }
  }

  const targetWorld = target.parentId ? worldMatrix(doc, target.parentId) : null;
  const worlds = new Map(moving.map((id) => [id, worldMatrix(doc, id)]));

  // Detach from current parents.
  for (const id of moving) {
    const node = doc.nodes[id]!;
    const siblings = childIdsOf(doc, node.pageId, node.parentId);
    siblings.splice(siblings.indexOf(id), 1);
  }

  const siblings = childIdsOf(doc, target.pageId, target.parentId);
  const at = target.index === undefined ? siblings.length : Math.max(0, Math.min(target.index, siblings.length));
  siblings.splice(at, 0, ...moving);

  const inverseParent = targetWorld ? invert(targetWorld) : null;
  for (const id of moving) {
    const node = doc.nodes[id]!;
    node.parentId = target.parentId;
    if (node.pageId !== target.pageId) setPageRecursive(doc, id, target.pageId);
    const world = worlds.get(id)!;
    assignTransform(node, inverseParent ? multiply(inverseParent, world) : world);
  }
}

export type ReorderDirection = 'forward' | 'backward' | 'front' | 'back';

/** Changes stacking order within each node's current parent. */
export function reorderNodes(doc: DesignDocument, ids: readonly NodeId[], direction: ReorderDirection): void {
  if (ids.some((id) => doc.nodes[id] && isInsideInstance(doc, id))) throw new DocumentError(INSTANCE_STRUCTURE_ERROR);
  const selected = new Set(ids.filter((id) => doc.nodes[id]));
  const lists = new Set<NodeId[]>();
  for (const id of selected) {
    const node = doc.nodes[id]!;
    lists.add(childIdsOf(doc, node.pageId, node.parentId));
  }
  for (const list of lists) {
    const isSel = (i: number) => selected.has(list[i]!);
    if (direction === 'front' || direction === 'back') {
      const picked = list.filter((id) => selected.has(id));
      const rest = list.filter((id) => !selected.has(id));
      const next = direction === 'front' ? [...rest, ...picked] : [...picked, ...rest];
      next.forEach((id, i) => {
        if (list[i] !== id) list[i] = id;
      });
    } else if (direction === 'forward') {
      for (let i = list.length - 2; i >= 0; i--) {
        if (isSel(i) && !isSel(i + 1)) [list[i], list[i + 1]] = [list[i + 1]!, list[i]!];
      }
    } else {
      for (let i = 1; i < list.length; i++) {
        if (isSel(i) && !isSel(i - 1)) [list[i - 1], list[i]] = [list[i]!, list[i - 1]!];
      }
    }
  }
}

/**
 * Wraps nodes in a new group (or a transparent, non-clipping frame). The wrapper goes where
 * the top-most selected node was. Returns the new container's id.
 */
export function groupNodes(doc: DesignDocument, ids: readonly NodeId[], kind: 'group' | 'frame' = 'group'): NodeId {
  const moving = sortByRenderOrder(doc, topMostIds(doc, ids));
  if (moving.length === 0) throw new DocumentError('Nothing to group');
  const top = doc.nodes[moving[moving.length - 1]!]!;
  const pageId = top.pageId;
  const parentId = top.parentId;
  if (moving.some((id) => doc.nodes[id]!.pageId !== pageId)) throw new DocumentError('Layers are on different pages');

  // Bounds of the selection in the new parent's coordinate space.
  const toParent = invert(parentId ? worldMatrix(doc, parentId) : [1, 0, 0, 1, 0, 0]);
  const pts: Point[] = [];
  for (const id of moving) {
    const node = doc.nodes[id]!;
    const m = multiply(toParent, worldMatrix(doc, id));
    for (const c of boxCorners(node.width, node.height)) pts.push(applyMatrix(m, c));
  }
  const b = boundsOfPoints(pts);
  const init = { pageId, parentId, x: round(b.x, 4), y: round(b.y, 4), width: round(b.width, 4), height: round(b.height, 4) };
  const container =
    kind === 'group' ? createGroup(init) : { ...createFrame(init), fills: [], clipContent: false };

  const siblings = childIdsOf(doc, pageId, parentId);
  addNode(doc, container, siblings.indexOf(top.id) + 1);
  moveNodes(doc, moving, { pageId, parentId: container.id });
  return container.id;
}

/**
 * Releases the children of groups/frames into their parent (at the container's position)
 * and deletes the emptied containers. Returns the released child ids.
 */
export function ungroupNodes(doc: DesignDocument, ids: readonly NodeId[]): NodeId[] {
  const released: NodeId[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node || !isContainer(node)) continue;
    const children = [...node.childIds];
    const siblings = childIdsOf(doc, node.pageId, node.parentId);
    moveNodes(doc, children, { pageId: node.pageId, parentId: node.parentId, index: siblings.indexOf(id) });
    siblings.splice(siblings.indexOf(id), 1);
    delete doc.nodes[id];
    released.push(...children);
  }
  return released;
}

const EPS = 1e-6;

/** Refits one group's box to its children without moving anything on screen. */
function refitGroup(doc: DesignDocument, group: GroupNode): void {
  const pts: Point[] = [];
  for (const childId of group.childIds) {
    const child = doc.nodes[childId];
    if (!child) continue;
    const m = localMatrix(child);
    for (const c of boxCorners(child.width, child.height)) pts.push(applyMatrix(m, c));
  }
  const b = boundsOfPoints(pts);
  if (Math.abs(b.x) > EPS || Math.abs(b.y) > EPS) {
    for (const childId of group.childIds) {
      const child = doc.nodes[childId]!;
      child.x = round(child.x - b.x, 4);
      child.y = round(child.y - b.y, 4);
    }
    const shift = applyLinear(localMatrix(group), { x: b.x, y: b.y });
    group.x = round(group.x + shift.x, 4);
    group.y = round(group.y + shift.y, 4);
  }
  const width = round(b.width, 4);
  const height = round(b.height, 4);
  if (group.width !== width) group.width = width;
  if (group.height !== height) group.height = height;
}

/**
 * Keeps the group invariant after any edit: empty groups are removed and every group's
 * box wraps its children. Runs deepest groups first. Unchanged groups produce no writes.
 */
export function normalizeGroups(doc: DesignDocument): void {
  const order: GroupNode[] = [];
  const visit = (ids: readonly NodeId[]) => {
    for (const id of ids) {
      const node = doc.nodes[id];
      if (!node || !isContainer(node)) continue;
      visit(node.childIds);
      if (node.type === 'group') order.push(node);
    }
  };
  for (const page of doc.pages) visit(page.childIds);
  for (const group of order) {
    if (group.childIds.length === 0) {
      const siblings = childIdsOf(doc, group.pageId, group.parentId);
      siblings.splice(siblings.indexOf(group.id), 1);
      delete doc.nodes[group.id];
    } else {
      refitGroup(doc, group);
    }
  }
}

/**
 * Sets a node's size. Vectors scale their path; groups scale their children; frames without
 * auto layout move/resize their children according to each child's constraints.
 *
 * `manual` (default) means the user resized the layer: text switches to a fixed width/height,
 * a "hug" axis becomes "fixed", and instance layers record the size as an override. Layout
 * passes call it with `manual: false`.
 */
export function resizeNode(doc: DesignDocument, id: NodeId, width: number, height: number, opts: { manual?: boolean } = {}): void {
  const manual = opts.manual ?? true;
  const node = getNode(doc, id);
  if (!(width >= 0) || !(height >= 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new DocumentError('Size must be a non-negative number');
  }
  const sx = node.width ? width / node.width : 1;
  const sy = node.height ? height / node.height : 1;
  const changedW = round(width, 4) !== node.width;
  const changedH = round(height, 4) !== node.height && node.type !== 'line';
  if (manual && (changedW || changedH)) {
    trackOverrides(node, [...(changedW ? ['width'] : []), ...(changedH ? ['height'] : [])]);
    if (changedW && node.sizing.horizontal === 'hug') node.sizing = { ...node.sizing, horizontal: 'fixed' };
    if (changedH && node.sizing.vertical === 'hug') node.sizing = { ...node.sizing, vertical: 'fixed' };
  }
  switch (node.type) {
    case 'frame':
    case 'component':
    case 'component-set':
    case 'instance':
      if (!node.layout) applyConstraints(doc, node.childIds, node.width, node.height, width, height);
      break;
    case 'line':
      node.width = width;
      return;
    case 'vector':
      if (sx !== 1 || sy !== 1) {
        node.vertices = node.vertices.map((v) => ({
          x: round(v.x * sx, 4),
          y: round(v.y * sy, 4),
          inX: round(v.inX * sx, 4),
          inY: round(v.inY * sy, 4),
          outX: round(v.outX * sx, 4),
          outY: round(v.outY * sy, 4),
        }));
      }
      break;
    case 'group':
      for (const childId of node.childIds) {
        const child = doc.nodes[childId];
        if (!child) continue;
        child.x = round(child.x * sx, 4);
        child.y = round(child.y * sy, 4);
        resizeNode(doc, childId, child.width * sx, child.height * sy, { manual });
      }
      break;
    case 'text':
      if (manual && changedH) node.autoResize = 'none';
      else if (manual && changedW && node.autoResize === 'width-and-height') node.autoResize = 'height';
      break;
  }
  node.width = round(width, 4);
  node.height = round(height, 4);
}

/** Moves/resizes children after their parent changed from oldW x oldH to newW x newH. */
export function applyConstraints(doc: DesignDocument, childIds: readonly NodeId[], oldW: number, oldH: number, newW: number, newH: number): void {
  const dW = newW - oldW;
  const dH = newH - oldH;
  if (dW === 0 && dH === 0) return;
  const sx = oldW ? newW / oldW : 1;
  const sy = oldH ? newH / oldH : 1;
  for (const childId of childIds) {
    const c = doc.nodes[childId];
    if (!c) continue;
    let { x, y, width: w, height: h } = c;
    switch (c.constraints.horizontal) {
      case 'right':
        x += dW;
        break;
      case 'center':
        x += dW / 2;
        break;
      case 'left-right':
        w = Math.max(0, w + dW);
        break;
      case 'scale':
        x *= sx;
        w *= sx;
        break;
    }
    switch (c.constraints.vertical) {
      case 'bottom':
        y += dH;
        break;
      case 'center':
        y += dH / 2;
        break;
      case 'top-bottom':
        h = Math.max(0, h + dH);
        break;
      case 'scale':
        y *= sy;
        h *= sy;
        break;
    }
    if (c.type === 'line') h = 0;
    c.x = round(x, 4);
    c.y = round(y, 4);
    if (round(w, 4) !== c.width || round(h, 4) !== c.height) resizeNode(doc, childId, w, h, { manual: false });
  }
}

/** Moves a node by a page-space delta (works inside rotated parents). */
export function translateWorld(doc: DesignDocument, id: NodeId, dx: number, dy: number): void {
  const node = getNode(doc, id);
  if (dx === 0 && dy === 0) return;
  const local = applyLinear(invert(parentWorldMatrix(doc, id)), { x: dx, y: dy });
  node.x = round(node.x + local.x, 4);
  node.y = round(node.y + local.y, 4);
}

export type AlignMode = 'left' | 'h-center' | 'right' | 'top' | 'v-center' | 'bottom';

/**
 * Aligns nodes to the selection bounds, or - for a single node - to its parent's box.
 * Returns false when there is nothing to align to.
 */
export function alignNodes(doc: DesignDocument, ids: readonly NodeId[], mode: AlignMode): boolean {
  const nodes = topMostIds(doc, ids);
  if (nodes.length === 0) return false;
  let ref;
  if (nodes.length === 1) {
    const parentId = doc.nodes[nodes[0]!]!.parentId;
    if (!parentId) return false;
    ref = nodeBounds(doc, parentId);
  } else {
    ref = selectionBounds(doc, nodes)!;
  }
  for (const id of nodes) {
    const b = nodeBounds(doc, id);
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = ref.x - b.x;
    else if (mode === 'h-center') dx = ref.x + ref.width / 2 - (b.x + b.width / 2);
    else if (mode === 'right') dx = ref.x + ref.width - (b.x + b.width);
    else if (mode === 'top') dy = ref.y - b.y;
    else if (mode === 'v-center') dy = ref.y + ref.height / 2 - (b.y + b.height / 2);
    else dy = ref.y + ref.height - (b.y + b.height);
    translateWorld(doc, id, dx, dy);
  }
  return true;
}

/** Spaces three or more nodes evenly between the outer-most two. */
export function distributeNodes(doc: DesignDocument, ids: readonly NodeId[], axis: 'horizontal' | 'vertical'): boolean {
  const nodes = topMostIds(doc, ids);
  if (nodes.length < 3) return false;
  const horiz = axis === 'horizontal';
  const items = nodes
    .map((id) => ({ id, b: nodeBounds(doc, id) }))
    .sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y));
  const start = (r: { x: number; y: number }) => (horiz ? r.x : r.y);
  const size = (r: { width: number; height: number }) => (horiz ? r.width : r.height);
  const first = items[0]!.b;
  const last = items[items.length - 1]!.b;
  const span = start(last) + size(last) - start(first);
  const total = items.reduce((sum, it) => sum + size(it.b), 0);
  const gap = (span - total) / (items.length - 1);
  let cursor = start(first) + size(first) + gap;
  for (const it of items.slice(1, -1)) {
    const delta = cursor - start(it.b);
    translateWorld(doc, it.id, horiz ? delta : 0, horiz ? 0 : delta);
    cursor += size(it.b) + gap;
  }
  return true;
}
