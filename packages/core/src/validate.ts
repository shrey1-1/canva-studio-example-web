/**
 * Runtime validation for data that comes from outside the editor: stored documents,
 * clipboard contents and (later) plugin / API input. Returns a list of problems instead
 * of throwing, so callers can decide how to report them.
 */
import { NODE_TYPES, type DesignDocument, type SceneNode } from './model';
import { interactionsProblem, SCROLL_BEHAVIORS } from './prototype';

type Obj = Record<string, unknown>;

/** Sanity limits that keep hostile or corrupted input from freezing the renderer. */
const MAX_SIZE = 1_000_000;
const MAX_VERTICES = 10_000;
const MAX_TEXT = 100_000;
/** Same limits as the inspector; larger values would allocate huge canvases. */
export const MAX_BLUR_RADIUS = 250;
export const MAX_SHADOW_BLUR = 500;
/** Deeper nesting than this is never produced by the editor and would risk stack overflows. */
const MAX_DEPTH = 256;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isHex = (v: unknown) => isStr(v) && /^#[0-9a-fA-F]{6}$/.test(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => isStr(v) && values.includes(v as T);

function checkPaint(p: unknown): boolean {
  return isObj(p) && p.type === 'solid' && isHex(p.color) && isNum(p.opacity) && isBool(p.visible);
}

function checkStroke(s: unknown): boolean {
  return isObj(s) && isHex(s.color) && isNum(s.width) && s.width >= 0 && isNum(s.opacity) && isBool(s.visible);
}

const CONSTRAINT_H = ['left', 'right', 'left-right', 'center', 'scale'] as const;
const CONSTRAINT_V = ['top', 'bottom', 'top-bottom', 'center', 'scale'] as const;
const SIZING = ['fixed', 'hug', 'fill'] as const;
const BINDABLE = ['fill', 'stroke', 'opacity', 'cornerRadius', 'width', 'height', 'gap', 'padding', 'fontSize', 'characters', 'visible'] as const;
const isNullableSize = (v: unknown) => v === null || (isNum(v) && v >= 0 && v <= MAX_SIZE);
const isStrRecord = (v: unknown) => isObj(v) && Object.values(v).every(isStr);

function checkLayout(l: unknown): boolean {
  if (l === null) return true;
  if (!isObj(l)) return false;
  return (
    oneOf(l.direction, ['horizontal', 'vertical'] as const) &&
    ['gap', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].every((k) => isNum(l[k]) && (l[k] as number) >= 0 && (l[k] as number) <= MAX_SIZE) &&
    oneOf(l.primaryAlign, ['start', 'center', 'end', 'space-between'] as const) &&
    oneOf(l.counterAlign, ['start', 'center', 'end'] as const)
  );
}

function checkEffect(e: unknown): boolean {
  if (!isObj(e) || !isBool(e.visible)) return false;
  if (e.type === 'drop-shadow') {
    return isHex(e.color) && isNum(e.x) && isNum(e.y) && isNum(e.blur) && e.blur >= 0 && e.blur <= MAX_SHADOW_BLUR && isNum(e.opacity);
  }
  if (e.type === 'layer-blur') return isNum(e.radius) && e.radius >= 0 && e.radius <= MAX_BLUR_RADIUS;
  return false;
}

/** Returns a problem description, or null when the value is a well-formed node. */
export function nodeProblem(n: unknown): string | null {
  if (!isObj(n)) return 'not an object';
  if (!isStr(n.id) || !n.id) return 'missing id';
  const where = `node ${n.id}`;
  if (!oneOf(n.type, NODE_TYPES)) return `${where}: unknown type`;
  if (!isStr(n.name) || !isStr(n.pageId)) return `${where}: missing name/page`;
  if (!(n.parentId === null || isStr(n.parentId))) return `${where}: bad parentId`;
  for (const k of ['x', 'y', 'width', 'height', 'rotation', 'opacity'] as const) {
    if (!isNum(n[k])) return `${where}: ${k} is not a number`;
  }
  if ((n.width as number) < 0 || (n.height as number) < 0) return `${where}: negative size`;
  if ((n.width as number) > MAX_SIZE || (n.height as number) > MAX_SIZE) return `${where}: too large`;
  if ((n.opacity as number) < 0 || (n.opacity as number) > 1) return `${where}: opacity out of range`;
  for (const k of ['visible', 'locked', 'isMask'] as const) if (!isBool(n[k])) return `${where}: ${k} is not boolean`;
  if (!Array.isArray(n.fills) || !n.fills.every(checkPaint)) return `${where}: bad fills`;
  if (!Array.isArray(n.strokes) || !n.strokes.every(checkStroke)) return `${where}: bad strokes`;
  if (!Array.isArray(n.effects) || !n.effects.every(checkEffect)) return `${where}: bad effects`;
  const c = n.constraints;
  if (!isObj(c) || !oneOf(c.horizontal, CONSTRAINT_H) || !oneOf(c.vertical, CONSTRAINT_V)) return `${where}: bad constraints`;
  const sz = n.sizing;
  if (!isObj(sz) || !oneOf(sz.horizontal, SIZING) || !oneOf(sz.vertical, SIZING)) return `${where}: bad sizing`;
  for (const k of ['minWidth', 'maxWidth', 'minHeight', 'maxHeight'] as const) if (!isNullableSize(n[k])) return `${where}: bad ${k}`;
  if (n.componentNodeId !== undefined && !isStr(n.componentNodeId)) return `${where}: bad componentNodeId`;
  if (n.overrides !== undefined && (!Array.isArray(n.overrides) || !n.overrides.every(isStr) || n.overrides.length > 100)) return `${where}: bad overrides`;
  if (n.bindings !== undefined && (!isStrRecord(n.bindings) || !Object.keys(n.bindings as object).every((k) => (BINDABLE as readonly string[]).includes(k)))) {
    return `${where}: bad bindings`;
  }
  if (n.interactions !== undefined && interactionsProblem(n.interactions)) return `${where}: bad interactions`;

  switch (n.type) {
    case 'frame':
    case 'component':
    case 'component-set':
    case 'instance':
      if (!isNum(n.cornerRadius) || !isBool(n.clipContent) || !checkLayout(n.layout)) return `${where}: bad frame fields`;
      if (n.variableModes !== undefined && !isStrRecord(n.variableModes)) return `${where}: bad variable modes`;
      if (n.scroll !== undefined && !oneOf(n.scroll, SCROLL_BEHAVIORS)) return `${where}: bad scroll`;
      if (n.type === 'component' && (!isStr(n.description) || !isStrRecord(n.variantProps))) return `${where}: bad component fields`;
      if (n.type === 'instance' && !isStr(n.componentId)) return `${where}: bad instance`;
      break;
    case 'rectangle':
      if (!isNum(n.cornerRadius)) return `${where}: bad corner radius`;
      break;
    case 'polygon':
      if (!isNum(n.pointCount) || n.pointCount < 3 || n.pointCount > 60) return `${where}: bad point count`;
      break;
    case 'star':
      if (!isNum(n.pointCount) || n.pointCount < 3 || n.pointCount > 60 || !isNum(n.innerRadius)) {
        return `${where}: bad star fields`;
      }
      break;
    case 'line': {
      const caps = ['none', 'arrow', 'triangle', 'circle'] as const;
      if (!oneOf(n.startCap, caps) || !oneOf(n.endCap, caps)) return `${where}: bad line caps`;
      break;
    }
    case 'vector':
      if (!isBool(n.closed) || !Array.isArray(n.vertices) || n.vertices.length > MAX_VERTICES) return `${where}: bad vector`;
      for (const v of n.vertices) {
        if (!isObj(v) || !['x', 'y', 'inX', 'inY', 'outX', 'outY'].every((k) => isNum(v[k]))) return `${where}: bad vertex`;
      }
      break;
    case 'text':
      if (
        !isStr(n.characters) || !isStr(n.fontFamily) || !isNum(n.fontSize) || !isNum(n.fontWeight) ||
        !isBool(n.italic) || !oneOf(n.textAlign, ['left', 'center', 'right', 'justify'] as const) ||
        !isNum(n.lineHeight) || !isNum(n.letterSpacing) ||
        !oneOf(n.textDecoration, ['none', 'underline', 'line-through'] as const) ||
        !oneOf(n.autoResize, ['width-and-height', 'height', 'none'] as const)
      ) {
        return `${where}: bad text fields`;
      }
      if ((n.characters as string).length > MAX_TEXT || (n.fontSize as number) < 1 || (n.fontSize as number) > 2000) {
        return `${where}: text out of range`;
      }
      break;
    case 'image': {
      const c = n.crop;
      if (
        !isStr(n.assetId) || !isNum(n.naturalWidth) || !isNum(n.naturalHeight) || !isNum(n.cornerRadius) ||
        !oneOf(n.fit, ['fill', 'fit', 'stretch', 'crop'] as const) ||
        !isObj(c) || !isNum(c.x) || !isNum(c.y) || !isNum(c.width) || !isNum(c.height)
      ) {
        return `${where}: bad image fields`;
      }
      break;
    }
    case 'group':
      break;
  }
  if (['frame', 'component', 'component-set', 'instance', 'group'].includes(n.type)) {
    if (!Array.isArray(n.childIds) || !n.childIds.every(isStr)) return `${where}: bad childIds`;
  }
  return null;
}

/**
 * Checks a set of nodes for referential integrity: every child exists, points back to its
 * parent, sits on the same page, and nothing is reachable twice (no cycles / shared children).
 * `roots` are the entry points (page children or clipboard roots).
 */
export function treeProblem(
  nodes: Record<string, SceneNode>,
  roots: readonly string[],
  pageId?: string,
  seen: Set<string> = new Set(),
): string | null {
  const walk = (id: string, parentId: string | null, depth = 0): string | null => {
    const node = nodes[id];
    if (!node) return `missing node ${id}`;
    if (depth > MAX_DEPTH) return 'layers are nested too deeply';
    if (seen.has(id)) return `node ${id} appears twice`;
    seen.add(id);
    if (node.parentId !== parentId) return `node ${id} has the wrong parent`;
    if (pageId !== undefined && node.pageId !== pageId) return `node ${id} is on the wrong page`;
    if ('childIds' in node) {
      for (const c of node.childIds) {
        const problem = walk(c, id, depth + 1);
        if (problem) return problem;
      }
    }
    return null;
  };
  for (const r of roots) {
    const problem = walk(r, null);
    if (problem) return problem;
  }
  return null;
}

/** Full structural check of a document. Returns the first problem found, or null. */
export function documentProblem(doc: unknown): string | null {
  if (!isObj(doc)) return 'not an object';
  if (!isStr(doc.id) || !isStr(doc.name)) return 'missing id or name';
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) return 'no pages';
  if (!isObj(doc.nodes)) return 'missing nodes';
  const nodes = doc.nodes as Record<string, unknown>;
  for (const [key, node] of Object.entries(nodes)) {
    const problem = nodeProblem(node);
    if (problem) return problem;
    if ((node as Obj).id !== key) return `node key ${key} does not match its id`;
  }
  const seen = new Set<string>();
  for (const page of doc.pages) {
    if (!isObj(page) || !isStr(page.id) || !isStr(page.name) || !isHex(page.background) || !Array.isArray(page.childIds) || (page.flowStartId !== undefined && !isStr(page.flowStartId))) {
      return 'bad page';
    }
    const problem = treeProblem(nodes as Record<string, SceneNode>, page.childIds as string[], page.id, seen);
    if (problem) return problem;
  }
  if (seen.size !== Object.keys(nodes).length) return 'orphaned nodes';
  return variablesProblem(doc);
}

function variablesProblem(doc: Obj): string | null {
  const cols = doc.variableCollections;
  const vars = doc.variables;
  if (!Array.isArray(cols) || !Array.isArray(vars)) return 'missing variables';
  const modes = new Map<string, Set<string>>();
  for (const c of cols) {
    if (!isObj(c) || !isStr(c.id) || !isStr(c.name) || !Array.isArray(c.modes) || c.modes.length === 0 || !isStr(c.defaultModeId)) return 'bad variable collection';
    if (!c.modes.every((m) => isObj(m) && isStr(m.id) && isStr(m.name))) return 'bad variable mode';
    const ids = new Set((c.modes as { id: string }[]).map((m) => m.id));
    if (!ids.has(c.defaultModeId)) return 'bad default mode';
    modes.set(c.id, ids);
  }
  for (const v of vars) {
    if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.collectionId) || !modes.has(v.collectionId)) return 'bad variable';
    if (!oneOf(v.type, ['color', 'number', 'string', 'boolean'] as const) || !isObj(v.valuesByMode)) return 'bad variable';
    for (const value of Object.values(v.valuesByMode)) {
      const ok =
        v.type === 'color' ? isHex(value) : v.type === 'number' ? isNum(value) : v.type === 'string' ? isStr(value) : isBool(value);
      if (!ok) return `variable ${v.name} has a bad value`;
    }
  }
  return null;
}

export function isValidDocument(doc: unknown): doc is DesignDocument {
  return documentProblem(doc) === null;
}
