/**
 * 2D geometry: affine matrices, node transforms and bounds, and node outlines.
 *
 * Outlines are lists of path commands (M/L/C/Z only) so the same geometry can be drawn
 * on a canvas, turned into an SVG path (`toSvgPath`) for rendering/export, and used for
 * clipping masks.
 */
import { isContainer, type DesignDocument, type NodeId, type SceneNode, type VectorVertex } from './model';
import type { Point, Rect } from './viewport';

/** Canvas-style affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function applyMatrix(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Applies only the linear part (for direction vectors such as drag deltas). */
export function applyLinear(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y };
}

export function transformMatrix(x: number, y: number, rotationDeg: number): Matrix {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, x, y];
}

/** Splits a rotation + translation matrix (no scale) back into x, y and rotation in [0, 360). */
export function decompose(m: Matrix): { x: number; y: number; rotation: number } {
  let rotation = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  rotation = round(((rotation % 360) + 360) % 360, 4);
  if (rotation === 360) rotation = 0;
  return { x: round(m[4], 4), y: round(m[5], 4), rotation };
}

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f + 0; // + 0 turns -0 into 0
};

export function localMatrix(node: Pick<SceneNode, 'x' | 'y' | 'rotation'>): Matrix {
  return transformMatrix(node.x, node.y, node.rotation);
}

/** Page-space matrix of a node's parent (identity for top-level nodes). */
export function parentWorldMatrix(doc: DesignDocument, id: NodeId): Matrix {
  const parentId = doc.nodes[id]?.parentId;
  return parentId ? worldMatrix(doc, parentId) : IDENTITY;
}

/** Page-space matrix of a node, including all ancestor transforms. */
export function worldMatrix(doc: DesignDocument, id: NodeId): Matrix {
  const chain: SceneNode[] = [];
  let current = doc.nodes[id];
  while (current) {
    chain.push(current);
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  let m = IDENTITY;
  for (let i = chain.length - 1; i >= 0; i--) m = multiply(m, localMatrix(chain[i]!));
  return m;
}

export function boxCorners(width: number, height: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

export function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Axis-aligned bounds of a node's box after applying `m` (defaults to the node's world matrix). */
export function nodeBounds(doc: DesignDocument, id: NodeId, m: Matrix = worldMatrix(doc, id)): Rect {
  const node = doc.nodes[id];
  if (!node) return { x: 0, y: 0, width: 0, height: 0 };
  return boundsOfPoints(boxCorners(node.width, node.height).map((p) => applyMatrix(m, p)));
}

/** Page-space axis-aligned bounds of several nodes. */
export function selectionBounds(doc: DesignDocument, ids: readonly NodeId[]): Rect | null {
  const pts: Point[] = [];
  for (const id of ids) {
    const node = doc.nodes[id];
    if (!node) continue;
    const m = worldMatrix(doc, id);
    for (const c of boxCorners(node.width, node.height)) pts.push(applyMatrix(m, c));
  }
  return pts.length ? boundsOfPoints(pts) : null;
}

/** True when the page-space point is inside the node's (possibly rotated) box. */
export function containsPoint(doc: DesignDocument, id: NodeId, p: Point): boolean {
  const node = doc.nodes[id];
  if (!node) return false;
  const local = applyMatrix(invert(worldMatrix(doc, id)), p);
  return local.x >= 0 && local.y >= 0 && local.x <= node.width && local.y <= node.height;
}

// ---------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------

export type PathCommand =
  | { c: 'M'; x: number; y: number }
  | { c: 'L'; x: number; y: number }
  | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { c: 'Z' };

/** Bezier constant for approximating a quarter circle. */
const KAPPA = 0.5522847498;

export function rectPath(w: number, h: number, radius = 0): PathCommand[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) {
    return [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: w, y: 0 }, { c: 'L', x: w, y: h }, { c: 'L', x: 0, y: h }, { c: 'Z' }];
  }
  const k = r * (1 - KAPPA);
  return [
    { c: 'M', x: r, y: 0 },
    { c: 'L', x: w - r, y: 0 },
    { c: 'C', x1: w - k, y1: 0, x2: w, y2: k, x: w, y: r },
    { c: 'L', x: w, y: h - r },
    { c: 'C', x1: w, y1: h - k, x2: w - k, y2: h, x: w - r, y: h },
    { c: 'L', x: r, y: h },
    { c: 'C', x1: k, y1: h, x2: 0, y2: h - k, x: 0, y: h - r },
    { c: 'L', x: 0, y: r },
    { c: 'C', x1: 0, y1: k, x2: k, y2: 0, x: r, y: 0 },
    { c: 'Z' },
  ];
}

export function ellipsePath(w: number, h: number): PathCommand[] {
  const rx = w / 2;
  const ry = h / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    { c: 'M', x: w, y: ry },
    { c: 'C', x1: w, y1: ry + oy, x2: rx + ox, y2: h, x: rx, y: h },
    { c: 'C', x1: rx - ox, y1: h, x2: 0, y2: ry + oy, x: 0, y: ry },
    { c: 'C', x1: 0, y1: ry - oy, x2: rx - ox, y2: 0, x: rx, y: 0 },
    { c: 'C', x1: rx + ox, y1: 0, x2: w, y2: ry - oy, x: w, y: ry },
    { c: 'Z' },
  ];
}

/** Points on a unit circle (first at the top), stretched so their bounds fill the box. */
function fitPointsToBox(unit: Point[], w: number, h: number): Point[] {
  const b = boundsOfPoints(unit);
  return unit.map((p) => ({
    x: b.width ? ((p.x - b.x) / b.width) * w : w / 2,
    y: b.height ? ((p.y - b.y) / b.height) * h : h / 2,
  }));
}

function polyline(points: Point[]): PathCommand[] {
  if (points.length === 0) return [];
  return [
    { c: 'M', ...points[0]! },
    ...points.slice(1).map((p): PathCommand => ({ c: 'L', ...p })),
    { c: 'Z' },
  ];
}

export function polygonPoints(w: number, h: number, count: number): Point[] {
  const n = Math.max(3, Math.round(count));
  const unit = Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
  return fitPointsToBox(unit, w, h);
}

export function starPoints(w: number, h: number, count: number, innerRadius: number): Point[] {
  const n = Math.max(3, Math.round(count));
  const inner = Math.max(0.01, Math.min(1, innerRadius));
  const unit = Array.from({ length: n * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const r = i % 2 === 0 ? 1 : inner;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  // Fit by the outer points so the tips touch the box edges.
  const outer = boundsOfPoints(unit.filter((_, i) => i % 2 === 0));
  return unit.map((p) => ({
    x: outer.width ? ((p.x - outer.x) / outer.width) * w : w / 2,
    y: outer.height ? ((p.y - outer.y) / outer.height) * h : h / 2,
  }));
}

export function vectorPath(vertices: readonly VectorVertex[], closed: boolean): PathCommand[] {
  if (vertices.length === 0) return [];
  const cmds: PathCommand[] = [{ c: 'M', x: vertices[0]!.x, y: vertices[0]!.y }];
  const segment = (a: VectorVertex, b: VectorVertex) => {
    if (a.outX === 0 && a.outY === 0 && b.inX === 0 && b.inY === 0) {
      cmds.push({ c: 'L', x: b.x, y: b.y });
    } else {
      cmds.push({ c: 'C', x1: a.x + a.outX, y1: a.y + a.outY, x2: b.x + b.inX, y2: b.y + b.inY, x: b.x, y: b.y });
    }
  };
  for (let i = 1; i < vertices.length; i++) segment(vertices[i - 1]!, vertices[i]!);
  if (closed && vertices.length > 1) {
    segment(vertices[vertices.length - 1]!, vertices[0]!);
    cmds.push({ c: 'Z' });
  }
  return cmds;
}

/** The node's outline in local coordinates. Containers, text and images use their box. */
export function nodeOutline(node: SceneNode): PathCommand[] {
  switch (node.type) {
    case 'rectangle':
    case 'frame':
    case 'component':
    case 'component-set':
    case 'instance':
    case 'image':
      return rectPath(node.width, node.height, node.cornerRadius);
    case 'ellipse':
      return ellipsePath(node.width, node.height);
    case 'polygon':
      return polyline(polygonPoints(node.width, node.height, node.pointCount));
    case 'star':
      return polyline(starPoints(node.width, node.height, node.pointCount, node.innerRadius));
    case 'line':
      return [{ c: 'M', x: 0, y: 0 }, { c: 'L', x: node.width, y: 0 }];
    case 'vector':
      return vectorPath(node.vertices, node.closed);
    case 'group':
    case 'text':
      return rectPath(node.width, node.height);
  }
}

/** True when the outline is open (strokes only, nothing to fill). */
export function isOpenPath(node: SceneNode): boolean {
  return node.type === 'line' || (node.type === 'vector' && !node.closed);
}

const fmt = (v: number) => String(round(v, 3));

export function toSvgPath(cmds: readonly PathCommand[]): string {
  return cmds
    .map((c) => {
      switch (c.c) {
        case 'M':
        case 'L':
          return `${c.c}${fmt(c.x)} ${fmt(c.y)}`;
        case 'C':
          return `C${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');
}

/** Minimal 2D drawing surface (a CanvasRenderingContext2D or Konva's context both fit). */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
  closePath(): void;
}

export function tracePath(sink: PathSink, cmds: readonly PathCommand[]): void {
  for (const c of cmds) {
    if (c.c === 'M') sink.moveTo(c.x, c.y);
    else if (c.c === 'L') sink.lineTo(c.x, c.y);
    else if (c.c === 'C') sink.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else sink.closePath();
  }
}

/** Exact bounds of a path, including the extremes of bezier curves. */
export function pathBounds(cmds: readonly PathCommand[]): Rect {
  const pts: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  for (const c of cmds) {
    if (c.c === 'M' || c.c === 'L') {
      cur = { x: c.x, y: c.y };
      pts.push(cur);
    } else if (c.c === 'C') {
      const p0 = cur;
      const p3 = { x: c.x, y: c.y };
      pts.push(p3);
      for (const t of [...cubicExtrema(p0.x, c.x1, c.x2, c.x), ...cubicExtrema(p0.y, c.y1, c.y2, c.y)]) {
        pts.push(cubicAt(p0, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, p3, t));
      }
      cur = p3;
    }
  }
  return boundsOfPoints(pts);
}

function cubicAt(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Parameter values in (0,1) where a 1D cubic bezier has a local extreme. */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number): number[] {
  // Derivative: 3[(p1-p0)(1-t)^2 + 2(p2-p1)(1-t)t + (p3-p2)t^2] = at^2 + bt + c
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      roots.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

/** Collects a node id and all of its descendants (depth first). */
export function subtreeIds(doc: DesignDocument, id: NodeId, out: NodeId[] = []): NodeId[] {
  const node = doc.nodes[id];
  if (!node) return out;
  out.push(id);
  if (isContainer(node)) for (const child of node.childIds) subtreeIds(doc, child, out);
  return out;
}
