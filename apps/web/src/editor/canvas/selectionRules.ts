import { isAncestor, isFrameLike, type DesignDocument, type NodeId } from '@canvas-studio/core';

/** Ids from the node up to its top-level ancestor. */
function ancestry(doc: DesignDocument, id: NodeId): NodeId[] {
  const chain: NodeId[] = [];
  let current: NodeId | null = id;
  while (current && doc.nodes[current]) {
    chain.push(current);
    current = doc.nodes[current]!.parentId;
  }
  return chain;
}

/** A group is "entered" once something inside it is selected; clicks then reach its children. */
const isEntered = (doc: DesignDocument, groupId: NodeId, selection: readonly NodeId[]) =>
  selection.some((s) => s !== groupId && isAncestor(doc, groupId, s));

/**
 * Which node a click on `hitId` (the deepest node under the pointer) selects.
 * Like most design tools, clicking inside a group or instance selects the outermost one that
 * has not been entered yet; frames do not capture clicks.
 */
export function resolveClickTarget(doc: DesignDocument, hitId: NodeId, selection: readonly NodeId[]): NodeId {
  const chain = ancestry(doc, hitId);
  for (let i = chain.length - 1; i >= 1; i--) {
    const id = chain[i]!;
    const type = doc.nodes[id]!.type;
    if ((type === 'group' || type === 'instance') && !isEntered(doc, id, selection)) return id;
  }
  return hitId;
}

/** Double-click goes one level deeper than a single click would. */
export function resolveDoubleClickTarget(doc: DesignDocument, hitId: NodeId, selection: readonly NodeId[]): NodeId {
  const target = resolveClickTarget(doc, hitId, selection);
  if (target === hitId) return hitId;
  const chain = ancestry(doc, hitId);
  return chain[chain.indexOf(target) - 1] ?? hitId;
}

/**
 * Top-level frames that contain layers behave like artboards: clicking their empty area
 * starts a marquee instead of selecting them (select them by their name label or the Layers
 * panel). Once selected, they can be dragged from anywhere.
 */
export function isArtboardBackground(doc: DesignDocument, id: NodeId, selection: readonly NodeId[]): boolean {
  const node = doc.nodes[id];
  if (!node || !isFrameLike(node) || node.type === 'instance' || node.childIds.length === 0 || selection.includes(id)) return false;
  // Top-level frames/components, and the variants inside a component set.
  return node.parentId === null || doc.nodes[node.parentId]?.type === 'component-set';
}
