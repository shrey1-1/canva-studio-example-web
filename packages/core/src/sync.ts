/**
 * Real-time sync: a change between two versions of a document, at the granularity of whole
 * nodes (plus the page list, the name and the variables). Concurrent edits to different layers
 * merge; edits to the same layer resolve last-writer-wins. The server validates every result.
 */
import type { DesignDocument, NodeId, Page, SceneNode, Variable, VariableCollection } from './model';
import type { TextMeasure } from './text';

export interface DocChange {
  /** Changed or added nodes; `null` = deleted. */
  nodes?: Record<NodeId, SceneNode | null>;
  pages?: Page[];
  name?: string;
  variableCollections?: VariableCollection[];
  variables?: Variable[];
}

/**
 * What changed from `prev` to `next`. Relies on immutable updates (Immer structural sharing):
 * an unchanged node keeps the same object, so the scan is cheap. Returns null when nothing changed.
 */
export function diffDocuments(prev: DesignDocument, next: DesignDocument): DocChange | null {
  const change: DocChange = {};
  if (prev.nodes !== next.nodes) {
    const nodes: Record<NodeId, SceneNode | null> = {};
    let any = false;
    for (const [id, node] of Object.entries(next.nodes)) {
      if (prev.nodes[id] !== node) {
        nodes[id] = node;
        any = true;
      }
    }
    for (const id of Object.keys(prev.nodes)) {
      if (!(id in next.nodes)) {
        nodes[id] = null;
        any = true;
      }
    }
    if (any) change.nodes = nodes;
  }
  if (prev.pages !== next.pages) change.pages = next.pages;
  if (prev.name !== next.name) change.name = next.name;
  if (prev.variableCollections !== next.variableCollections) change.variableCollections = next.variableCollections;
  if (prev.variables !== next.variables) change.variables = next.variables;
  return Object.keys(change).length ? change : null;
}

/** Returns a new document with the change applied (the input is not modified). */
export function applyDocChange(doc: DesignDocument, change: DocChange): DesignDocument {
  const next: DesignDocument = { ...doc };
  if (change.nodes) {
    next.nodes = { ...doc.nodes };
    for (const [id, node] of Object.entries(change.nodes)) {
      if (node === null) delete next.nodes[id];
      else next.nodes[id] = node;
    }
  }
  if (change.pages) next.pages = change.pages;
  if (change.name !== undefined) next.name = change.name;
  if (change.variableCollections) next.variableCollections = change.variableCollections;
  if (change.variables) next.variables = change.variables;
  return next;
}

/** Ids touched by a change (used to re-send local edits made while offline). */
export function changedNodeIds(change: DocChange): NodeId[] {
  return Object.keys(change.nodes ?? {});
}

/** Text measure without a browser (server, agents): average glyph width. The editor re-measures on open. */
export const approximateTextMeasure: TextMeasure = (node, width) => {
  const charW = node.fontSize * 0.55 + node.letterSpacing;
  const lineH = node.fontSize * node.lineHeight;
  const paragraphs = node.characters.split('\n');
  if (width === null) {
    return { width: Math.ceil(Math.max(1, ...paragraphs.map((p) => p.length * charW))), height: Math.ceil(paragraphs.length * lineH) };
  }
  const perLine = Math.max(1, Math.floor(width / Math.max(1, charW)));
  const lines = paragraphs.reduce((n, p) => n + Math.max(1, Math.ceil(p.length / perLine)), 0);
  return { width, height: Math.ceil(lines * lineH) };
};
