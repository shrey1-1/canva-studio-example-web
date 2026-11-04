/**
 * Builds layers from the simple specs tools send ("a red rectangle at 10,10"). Specs come from
 * plugin code, which is untrusted, so every field is type- and range-checked and the finished
 * node is validated like any stored layer.
 */
import {
  createEllipse,
  createFrame,
  createLine,
  createPolygon,
  createRectangle,
  createStar,
  createText,
  createVector,
  solid,
  vertex,
} from '../factory';
import { pathBounds, vectorPath } from '../geometry';
import type { NodeId, PageId, SceneNode } from '../model';
import { DocumentError } from '../ops';
import { nodeProblem } from '../validate';

export const SPEC_TYPES = ['frame', 'rectangle', 'ellipse', 'polygon', 'star', 'line', 'text', 'vector'] as const;
export type SpecType = (typeof SPEC_TYPES)[number];

export interface NodeSpec {
  type: SpecType;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  /** Hex colour or null for no fill. */
  fill?: string | null;
  stroke?: { color: string; width: number } | null;
  cornerRadius?: number;
  clipContent?: boolean;
  characters?: string;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  /** Vector: polygon points in the spec's own coordinates; the node box is their bounds. */
  points?: [number, number][];
  closed?: boolean;
  pointCount?: number;
  innerRadius?: number;
  shadow?: { color: string; x: number; y: number; blur: number; opacity: number } | null;
}

const LIMIT = 1_000_000;
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

function num(spec: Record<string, unknown>, key: string, min = -LIMIT, max = LIMIT): number | undefined {
  const v = spec[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new DocumentError(`"${key}" must be a number between ${min} and ${max}`);
  }
  return v;
}

/** Turns an untrusted spec into a validated node (not yet added to the document). */
export function nodeFromSpec(input: unknown, pageId: PageId, parentId: NodeId | null): SceneNode {
  if (!input || typeof input !== 'object') throw new DocumentError('A node spec must be an object');
  const spec = input as Record<string, unknown>;
  const type = spec.type;
  if (!SPEC_TYPES.includes(type as SpecType)) throw new DocumentError(`Unsupported node type: ${String(type)}`);
  const name = spec.name === undefined ? undefined : String(spec.name).slice(0, 200);
  const init = {
    pageId,
    parentId,
    name,
    x: num(spec, 'x') ?? 0,
    y: num(spec, 'y') ?? 0,
    width: num(spec, 'width', 0),
    height: num(spec, 'height', 0),
    rotation: num(spec, 'rotation', -3600, 3600) ?? 0,
  };
  let node: SceneNode;
  switch (type as SpecType) {
    case 'frame':
      node = createFrame(init);
      if (spec.clipContent !== undefined) node.clipContent = Boolean(spec.clipContent);
      break;
    case 'rectangle':
      node = createRectangle(init);
      break;
    case 'ellipse':
      node = createEllipse(init);
      break;
    case 'polygon':
      node = createPolygon(init);
      node.pointCount = Math.round(num(spec, 'pointCount', 3, 60) ?? 3);
      break;
    case 'star':
      node = createStar(init);
      node.pointCount = Math.round(num(spec, 'pointCount', 3, 60) ?? 5);
      node.innerRadius = num(spec, 'innerRadius', 0.01, 1) ?? node.innerRadius;
      break;
    case 'line':
      node = createLine({ ...init, height: 0 });
      break;
    case 'text': {
      const characters = typeof spec.characters === 'string' ? spec.characters.slice(0, 100_000) : '';
      node = createText({ ...init, characters, fontSize: num(spec, 'fontSize', 1, 2000) });
      const weight = num(spec, 'fontWeight', 100, 900);
      if (weight !== undefined) node.fontWeight = Math.round(weight / 100) * 100;
      if (typeof spec.fontFamily === 'string') node.fontFamily = spec.fontFamily.slice(0, 100);
      break;
    }
    case 'vector': {
      const pts = spec.points;
      if (!Array.isArray(pts) || pts.length < 2 || pts.length > 10_000) throw new DocumentError('A vector needs 2 to 10000 points');
      const raw = pts.map((p) => {
        if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMIT)) {
          throw new DocumentError('Vector points must be [x, y] number pairs');
        }
        return vertex(p[0] as number, p[1] as number);
      });
      const closed = spec.closed !== false;
      const b = pathBounds(vectorPath(raw, closed));
      const vertices = raw.map((v) => ({ ...v, x: v.x - b.x, y: v.y - b.y }));
      node = createVector({ ...init, x: init.x + b.x, y: init.y + b.y, width: b.width, height: b.height, vertices, closed });
      break;
    }
  }
  const opacity = num(spec, 'opacity', 0, 1);
  if (opacity !== undefined) node.opacity = opacity;
  if (spec.fill !== undefined) {
    if (spec.fill === null) node.fills = [];
    else if (isHex(spec.fill)) node.fills = [solid(spec.fill.toUpperCase())];
    else throw new DocumentError('"fill" must be a #RRGGBB colour or null');
  }
  if (spec.stroke !== undefined) {
    const s = spec.stroke as Record<string, unknown> | null;
    if (s === null) node.strokes = [];
    else if (s && isHex(s.color) && typeof s.width === 'number' && s.width >= 0 && s.width <= 1000) {
      node.strokes = [{ color: s.color.toUpperCase(), width: s.width, opacity: 1, visible: true }];
    } else throw new DocumentError('"stroke" must be { color: "#RRGGBB", width: number }');
  }
  const radius = num(spec, 'cornerRadius', 0);
  if (radius !== undefined && 'cornerRadius' in node) node.cornerRadius = radius;
  if (spec.shadow) {
    const s = spec.shadow as Record<string, unknown>;
    const ok = isHex(s.color) && [s.x, s.y, s.blur, s.opacity].every((v) => typeof v === 'number' && Number.isFinite(v));
    if (!ok) throw new DocumentError('"shadow" must be { color, x, y, blur, opacity }');
    node.effects = [{ type: 'drop-shadow', color: s.color as string, x: s.x as number, y: s.y as number, blur: Math.max(0, Math.min(500, s.blur as number)), opacity: Math.max(0, Math.min(1, s.opacity as number)), visible: true }];
  }
  const problem = nodeProblem(node);
  if (problem) throw new DocumentError(`Invalid node: ${problem}`);
  return node;
}
