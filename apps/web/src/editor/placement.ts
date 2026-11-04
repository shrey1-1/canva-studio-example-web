import {
  contrastingInk,
  decompose,
  frameAtPoint,
  isFrameLike,
  invert,
  multiply,
  screenToWorld,
  transformMatrix,
  worldMatrix,
  type DesignDocument,
  type NodeId,
  type PageId,
  type Point,
  type Rect,
} from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';

/** Converts a page-space position/rotation into a parent's local coordinates. */
export function toLocal(doc: DesignDocument, parentId: NodeId | null, x: number, y: number, rotation = 0) {
  const world = transformMatrix(x, y, rotation);
  return decompose(parentId ? multiply(invert(worldMatrix(doc, parentId)), world) : world);
}

/** Where a new layer drawn at a page-space point should live: the frame under it, or the page. */
export function placeAt(doc: DesignDocument, pageId: PageId, p: Point, rotation = 0) {
  const parentId = frameAtPoint(doc, pageId, p.x, p.y);
  return { parentId, ...toLocal(doc, parentId, p.x, p.y, rotation) };
}

/** Black or white, for strokes/text drawn on top of the given parent (or the page). */
export function inkFor(doc: DesignDocument, pageId: PageId, parentId: NodeId | null): string {
  let current = parentId ? doc.nodes[parentId] : undefined;
  while (current) {
    const fill = [...current.fills].reverse().find((f) => f.visible && f.opacity > 0.3);
    if (isFrameLike(current) && fill) return contrastingInk(fill.color);
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return contrastingInk(doc.pages.find((p) => p.id === pageId)?.background ?? '#FFFFFF');
}

/** The part of the page currently visible on screen. */
export function visibleWorldRect(): Rect {
  const { viewport, canvasSize } = useEditor.getState();
  const a = screenToWorld(viewport, { x: 0, y: 0 });
  const b = screenToWorld(viewport, { x: canvasSize.width, y: canvasSize.height });
  return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
}

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const rectsIntersect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

/** Running count used for default layer names ("Rectangle 3"). */
export function nextName(doc: DesignDocument, base: string): string {
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  let max = 0;
  for (const node of Object.values(doc.nodes)) {
    const m = pattern.exec(node.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base} ${max + 1}`;
}
