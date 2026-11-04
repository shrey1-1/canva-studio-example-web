/**
 * Components, instances and variants.
 *
 * An instance stores real child layers (so selection, rendering and editing work like any
 * other layer). Each instance layer remembers the layer it mirrors (`componentNodeId`) and the
 * properties changed locally (`overrides`). `syncInstances` runs after every edit and makes
 * every instance match its source again, except for overridden properties. Instance layers
 * follow their constraints when the instance has a different size than its component.
 *
 * Nested instances: an instance inside a main component (N, an instance of D) is copied into
 * outer instances as an instance (N'). N' takes its own props from N and its children from N's
 * children (which already carry the main component's overrides), matched by D's layer ids.
 */
import { createId } from './factory';
import { round } from './geometry';
import {
  isContainer,
  isFrameLike,
  type ComponentNode,
  type ContainerNode,
  type DesignDocument,
  type InstanceNode,
  type NodeId,
  type PageId,
  type SceneNode,
} from './model';
import { DocumentError, addNode, getNode, instanceAncestor, isAncestor, isInsideInstance } from './ops';
import { groupNodes, topMostIds } from './structure';

const clone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Never copied from a source layer. */
const ALWAYS_SKIP = new Set(['id', 'type', 'pageId', 'parentId', 'childIds', 'componentNodeId', 'overrides']);
/** An instance's own placement and identity; never copied from its component. */
const ROOT_SKIP = new Set([
  ...ALWAYS_SKIP,
  'x', 'y', 'rotation', 'name', 'visible', 'locked', 'isMask', 'constraints', 'sizing',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'description', 'variantProps',
]);
/** A nested instance copy is placed and sized by its parent instance's sync (constraints). */
const NESTED_ROOT_SKIP = new Set([...ROOT_SKIP, 'width', 'height']);
/** Document keys written by variable bindings (bound keys are left to applyVariables). */
const BOUND_KEYS: Record<string, string> = {
  fill: 'fills', stroke: 'strokes', opacity: 'opacity', cornerRadius: 'cornerRadius', width: 'width', height: 'height',
  gap: 'layout', padding: 'layout', fontSize: 'fontSize', characters: 'characters', visible: 'visible',
};
const GEOMETRY_KEYS = new Set(['x', 'y', 'width', 'height', 'vertices']);

type Box = { x: number; y: number; width: number; height: number };

/** Where a child of a W0 x H0 parent ends up in a W1 x H1 parent, given its constraints. */
export function constrainedBox(src: SceneNode, w0: number, h0: number, w1: number, h1: number): Box {
  let { x, y, width, height } = src;
  const dW = w1 - w0;
  const dH = h1 - h0;
  const sx = w0 ? w1 / w0 : 1;
  const sy = h0 ? h1 / h0 : 1;
  const c = src.constraints;
  if (c.horizontal === 'right') x += dW;
  else if (c.horizontal === 'center') x += dW / 2;
  else if (c.horizontal === 'left-right') width = Math.max(0, width + dW);
  else if (c.horizontal === 'scale') {
    x *= sx;
    width *= sx;
  }
  if (c.vertical === 'bottom') y += dH;
  else if (c.vertical === 'center') y += dH / 2;
  else if (c.vertical === 'top-bottom') height = Math.max(0, height + dH);
  else if (c.vertical === 'scale') {
    y *= sy;
    height *= sy;
  }
  if (src.type === 'line') height = 0;
  return { x: round(x, 4), y: round(y, 4), width: round(width, 4), height: round(height, 4) };
}

function boundKeys(node: SceneNode): Set<string> {
  return new Set(Object.keys(node.bindings ?? {}).map((f) => BOUND_KEYS[f]!).filter(Boolean));
}

/** Copies every non-overridden property from `src` to `target`, writing only real changes. */
function syncProps(target: SceneNode, src: SceneNode, skip: Set<string>, box: Box | null) {
  const t = target as unknown as Record<string, unknown>;
  const s = src as unknown as Record<string, unknown>;
  const overridden = new Set(target.overrides ?? []);
  const bound = boundKeys(target);
  const keys = new Set([...Object.keys(s), ...Object.keys(t)]);
  for (const key of keys) {
    if (skip.has(key) || overridden.has(key) || key === 'vertices') continue;
    if (key === 'layout' && bound.has('layout')) {
      syncBoundLayout(target, src);
      continue;
    }
    if (bound.has(key)) continue;
    if (box && GEOMETRY_KEYS.has(key)) continue;
    if (!(key in s)) {
      if (key in t && (key === 'bindings' || key === 'variableModes')) delete t[key];
      continue;
    }
    if (!same(t[key], s[key])) t[key] = clone(s[key]);
  }
  if (box) {
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      if (!overridden.has(k) && !bound.has(k) && t[k] !== box[k]) t[k] = box[k];
    }
  }
  // Vertices always follow the layer's current size (box, layout or override), never a raw copy.
  if (src.type === 'vector' && target.type === 'vector' && !overridden.has('vertices')) {
    const sx = src.width ? target.width / src.width : 1;
    const sy = src.height ? target.height / src.height : 1;
    const scaled = src.vertices.map((v) => ({
      x: round(v.x * sx, 4), y: round(v.y * sy, 4),
      inX: round(v.inX * sx, 4), inY: round(v.inY * sy, 4), outX: round(v.outX * sx, 4), outY: round(v.outY * sy, 4),
    }));
    if (!same(target.vertices, scaled)) target.vertices = scaled;
  }
}

/** Copies auto layout from the source but keeps variable-driven gap/padding. */
function syncBoundLayout(target: SceneNode, src: SceneNode) {
  if (!('layout' in target) || !('layout' in src)) return;
  const tl = target.layout;
  const sl = src.layout;
  if (!sl || !tl) {
    if (!same(tl, sl)) (target as { layout: unknown }).layout = clone(sl);
    return;
  }
  const b = target.bindings ?? {};
  const merged = {
    ...sl,
    gap: b.gap ? tl.gap : sl.gap,
    paddingTop: b.padding ? tl.paddingTop : sl.paddingTop,
    paddingRight: b.padding ? tl.paddingRight : sl.paddingRight,
    paddingBottom: b.padding ? tl.paddingBottom : sl.paddingBottom,
    paddingLeft: b.padding ? tl.paddingLeft : sl.paddingLeft,
  };
  if (!same(tl, merged)) target.layout = merged;
}

function removeSubtree(doc: DesignDocument, id: NodeId) {
  const node = doc.nodes[id];
  if (!node) return;
  if (isContainer(node)) for (const c of node.childIds) removeSubtree(doc, c);
  delete doc.nodes[id];
}

type Mode = 'component' | 'instance';
const keyOf = (n: SceneNode, mode: Mode) => (mode === 'component' ? n.id : n.componentNodeId);

/** Makes `target`'s children mirror `source`'s children (structure and properties). */
function syncChildren(doc: DesignDocument, target: ContainerNode, source: ContainerNode, mode: Mode) {
  const existing = new Map<string, NodeId>();
  for (const id of target.childIds) {
    const k = doc.nodes[id]?.componentNodeId;
    if (k !== undefined && !existing.has(k)) existing.set(k, id);
    else removeSubtree(doc, id); // stray or duplicate layers cannot exist inside an instance
  }
  const useConstraints = !(isFrameLike(target) && target.layout) && (source.width !== target.width || source.height !== target.height);
  const next: NodeId[] = [];
  for (const srcId of source.childIds) {
    const src = doc.nodes[srcId];
    if (!src) continue;
    // Never copy an instance that would end up containing its own component (stops cycles).
    if (src.type === 'instance' && wouldCreateCycle(doc, src.componentId, target.id)) continue;
    const key = keyOf(src, mode);
    if (key === undefined) continue;
    let id = existing.get(key);
    let node = id ? doc.nodes[id] : undefined;
    if (node && node.type !== src.type) {
      removeSubtree(doc, id!);
      node = undefined;
    }
    if (id) existing.delete(key);
    if (!node) {
      const fresh = clone(src) as SceneNode;
      fresh.id = createId();
      fresh.pageId = target.pageId;
      fresh.parentId = target.id;
      fresh.componentNodeId = key;
      delete fresh.overrides;
      if (isContainer(fresh)) fresh.childIds = [];
      doc.nodes[fresh.id] = fresh;
      node = fresh;
      id = fresh.id;
    }
    const box = useConstraints ? constrainedBox(src, source.width, source.height, target.width, target.height) : null;
    syncProps(node, src, ALWAYS_SKIP, box);
    // Nested instances fill their own children (see syncInstance).
    if (isContainer(node) && isContainer(src) && node.type !== 'instance') syncChildren(doc, node, src, mode);
    next.push(id!);
  }
  for (const leftover of existing.values()) removeSubtree(doc, leftover);
  if (!same(target.childIds, next)) target.childIds = next;
}

/** Components this node sits inside, directly or through instances (used to stop cycles). */
export function componentsAbove(doc: DesignDocument, id: NodeId | null): Set<NodeId> {
  const out = new Set<NodeId>();
  let current = id ? doc.nodes[id] : undefined;
  while (current) {
    if (current.type === 'component') out.add(current.id);
    if (current.type === 'instance') out.add(current.componentId);
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return out;
}

/** Every component used (transitively) inside a component, including itself. */
export function componentDependencies(doc: DesignDocument, componentId: NodeId, seen = new Set<NodeId>()): Set<NodeId> {
  if (seen.has(componentId)) return seen;
  seen.add(componentId);
  const visit = (id: NodeId) => {
    const n = doc.nodes[id];
    if (!n) return;
    if (n.type === 'instance') componentDependencies(doc, n.componentId, seen);
    else if (isContainer(n)) n.childIds.forEach(visit);
  };
  const c = doc.nodes[componentId];
  if (c && isContainer(c)) c.childIds.forEach(visit);
  return seen;
}

/** True when placing an instance of `componentId` under `parentId` would make it contain itself. */
export function wouldCreateCycle(doc: DesignDocument, componentId: NodeId, parentId: NodeId | null): boolean {
  const above = componentsAbove(doc, parentId);
  if (above.size === 0) return false;
  for (const dep of componentDependencies(doc, componentId)) if (above.has(dep)) return true;
  return false;
}

function syncInstance(doc: DesignDocument, inst: InstanceNode) {
  const comp = doc.nodes[inst.componentId];
  if (!comp || comp.type !== 'component' || isAncestor(doc, comp.id, inst.id) || wouldCreateCycle(doc, comp.id, inst.parentId)) {
    detachInstance(doc, inst.id);
    return;
  }
  // Inside another instance, mirror the matching nested instance of that instance's source.
  const viaNested = inst.componentNodeId ? doc.nodes[inst.componentNodeId] : undefined;
  const source = viaNested && viaNested.type === 'instance' && viaNested.componentId === inst.componentId ? viaNested : comp;
  const mode: Mode = source === comp ? 'component' : 'instance';
  const skip = new Set(inst.componentNodeId !== undefined ? NESTED_ROOT_SKIP : ROOT_SKIP);
  // Sizes driven by auto layout (fill / hug) belong to the layout pass, not the component.
  if (inst.sizing.horizontal !== 'fixed') skip.add('width');
  if (inst.sizing.vertical !== 'fixed') skip.add('height');
  syncProps(inst, source, skip, null);
  syncChildren(doc, inst, source, mode);
}

/**
 * Brings every instance in line with its component (structure + non-overridden properties).
 * Instances whose component is gone, or that would contain themselves, are detached into frames.
 */
export function syncInstances(doc: DesignDocument): void {
  for (const node of Object.values(doc.nodes)) {
    if (node.componentNodeId !== undefined && !instanceAncestor(doc, node.id, false)) {
      delete node.componentNodeId;
      if (node.type !== 'instance') delete node.overrides;
    }
  }
  // Instances inside main components first, so copies of them see up-to-date sources.
  for (let pass = 0; pass < 3; pass++) {
    const instances = Object.values(doc.nodes).filter((n): n is InstanceNode => n.type === 'instance');
    const depth = (n: SceneNode) => componentsAbove(doc, n.parentId).size;
    instances.sort((a, b) => depth(a) - depth(b));
    for (const inst of instances) if (doc.nodes[inst.id]?.type === 'instance') syncInstance(doc, inst);
  }
}

/** Turns an instance into a plain frame that no longer follows its component. */
export function detachInstance(doc: DesignDocument, id: NodeId): NodeId {
  const node = getNode(doc, id);
  if (node.type !== 'instance') throw new DocumentError('Only instances can be detached');
  const strip = (childId: NodeId) => {
    const c = doc.nodes[childId];
    if (!c) return;
    delete c.componentNodeId;
    if (c.type === 'instance') return; // nested instances stay instances (of their own component)
    delete c.overrides;
    if (isContainer(c)) c.childIds.forEach(strip);
  };
  node.childIds.forEach(strip);
  const frame = node as unknown as Record<string, unknown>;
  frame.type = 'frame';
  delete frame.componentId;
  delete frame.overrides;
  if (node.componentNodeId !== undefined) delete frame.componentNodeId;
  return id;
}

/** Removes local changes so the instance matches its component again. */
export function resetOverrides(doc: DesignDocument, id: NodeId): void {
  const node = getNode(doc, id);
  if (node.type !== 'instance') throw new DocumentError('Only instances have overrides');
  const clear = (n: SceneNode) => {
    if (n.overrides) delete n.overrides;
    if (isContainer(n)) n.childIds.forEach((c) => doc.nodes[c] && clear(doc.nodes[c]!));
  };
  clear(node);
}

const hasComponentInside = (doc: DesignDocument, id: NodeId): boolean => {
  const n = doc.nodes[id];
  if (!n) return false;
  if (n.type === 'component' || n.type === 'component-set') return true;
  return isContainer(n) && n.childIds.some((c) => hasComponentInside(doc, c));
};

/**
 * Makes a main component from the selection: a single frame is converted in place; anything
 * else is wrapped in a new component. Returns the component id.
 */
export function createComponent(doc: DesignDocument, ids: readonly NodeId[]): NodeId {
  const top = topMostIds(doc, ids);
  if (top.length === 0) throw new DocumentError('Select layers to make a component');
  if (top.some((id) => isInsideInstance(doc, id) || hasComponentInside(doc, id) || doc.nodes[id]!.type === 'instance')) {
    throw new DocumentError('Components cannot contain other main components, and instances cannot be converted');
  }
  if (componentsAbove(doc, doc.nodes[top[0]!]!.parentId).size > 0) throw new DocumentError('A main component cannot be placed inside another component');
  let id: NodeId;
  if (top.length === 1 && doc.nodes[top[0]!]!.type === 'frame') {
    id = top[0]!;
  } else {
    id = groupNodes(doc, top, 'frame');
  }
  const node = doc.nodes[id] as unknown as Record<string, unknown>;
  node.type = 'component';
  node.description = '';
  node.variantProps = {};
  return id;
}

/** Wraps two or more components in a component set and gives each a variant name. */
export function combineAsVariants(doc: DesignDocument, ids: readonly NodeId[]): NodeId {
  const comps = topMostIds(doc, ids).map((id) => doc.nodes[id]!);
  if (comps.length < 2 || comps.some((c) => c.type !== 'component')) throw new DocumentError('Select two or more main components');
  if (comps.some((c) => c.parentId !== comps[0]!.parentId)) throw new DocumentError('Variants must share the same parent');
  if (comps[0]!.parentId && doc.nodes[comps[0]!.parentId]?.type === 'component-set') throw new DocumentError('These components are already variants');
  const setId = groupNodes(doc, comps.map((c) => c.id), 'frame');
  const set = doc.nodes[setId] as unknown as Record<string, unknown>;
  set.type = 'component-set';
  set.name = comps[0]!.name.split('/')[0]!.trim() || 'Component';
  // Padding keeps the variants' name labels clear of the set's own label and outline.
  const PAD = 20;
  const s = doc.nodes[setId]!;
  s.x -= PAD;
  s.y -= PAD;
  s.width += PAD * 2;
  s.height += PAD * 2;
  for (const c of comps) {
    c.x += PAD;
    c.y += PAD;
  }
  comps.forEach((c, i) => {
    const comp = c as ComponentNode;
    if (Object.keys(comp.variantProps).length === 0) comp.variantProps = { Property: i === 0 ? 'Default' : `Variant ${i + 1}` };
  });
  return setId;
}

/** The variant properties of a component set and the values each one takes. */
export function variantOptions(doc: DesignDocument, setId: NodeId): Record<string, string[]> {
  const set = doc.nodes[setId];
  const out: Record<string, string[]> = {};
  if (!set || set.type !== 'component-set') return out;
  for (const id of set.childIds) {
    const c = doc.nodes[id];
    if (c?.type !== 'component') continue;
    for (const [k, v] of Object.entries(c.variantProps)) {
      out[k] ??= [];
      if (!out[k]!.includes(v)) out[k]!.push(v);
    }
  }
  return out;
}

/** Switches an instance to the variant with `prop` = `value` (keeping its other properties). */
export function setInstanceVariant(doc: DesignDocument, instanceId: NodeId, prop: string, value: string): boolean {
  const inst = getNode(doc, instanceId);
  if (inst.type !== 'instance') throw new DocumentError('Not an instance');
  const comp = doc.nodes[inst.componentId];
  const set = comp?.parentId ? doc.nodes[comp.parentId] : undefined;
  if (comp?.type !== 'component' || set?.type !== 'component-set') return false;
  const wanted = { ...comp.variantProps, [prop]: value };
  const variants = set.childIds.map((id) => doc.nodes[id]).filter((c): c is ComponentNode => c?.type === 'component');
  const match =
    variants.find((c) => Object.entries(wanted).every(([k, v]) => c.variantProps[k] === v)) ??
    variants.find((c) => c.variantProps[prop] === value);
  if (!match || match.id === inst.componentId) return false;
  inst.componentId = match.id;
  if (inst.componentNodeId !== undefined) {
    inst.overrides = [...new Set([...(inst.overrides ?? []), 'componentId'])];
  }
  // Size follows the new variant unless the instance was resized.
  const resized = new Set(inst.overrides ?? []);
  if (!resized.has('width')) inst.width = match.width;
  if (!resized.has('height')) inst.height = match.height;
  return true;
}

export interface InstanceTarget {
  pageId: PageId;
  parentId: NodeId | null;
  x: number;
  y: number;
  index?: number;
}

/** Places a new instance of a component. Its layers are created by `syncInstances`. */
export function createInstance(doc: DesignDocument, componentId: NodeId, target: InstanceTarget): NodeId {
  const comp = getNode(doc, componentId);
  if (comp.type !== 'component') throw new DocumentError('Not a main component');
  if (target.parentId && instanceAncestor(doc, target.parentId)) throw new DocumentError('Instances cannot be placed inside another instance');
  if (wouldCreateCycle(doc, componentId, target.parentId)) throw new DocumentError('A component cannot contain an instance of itself');
  const base = clone(comp) as unknown as Record<string, unknown>;
  delete base.description;
  delete base.variantProps;
  const inst = {
    ...base,
    id: createId(),
    type: 'instance',
    componentId,
    name: comp.name,
    pageId: target.pageId,
    parentId: target.parentId,
    x: target.x,
    y: target.y,
    rotation: 0,
    childIds: [],
    constraints: { horizontal: 'left', vertical: 'top' },
  } as unknown as InstanceNode;
  addNode(doc, inst, target.index);
  syncInstance(doc, inst);
  return inst.id;
}

/** Main components in the document, with the set each belongs to (for the Assets panel). */
export function listComponents(doc: DesignDocument): { component: ComponentNode; setId: NodeId | null; pageId: PageId }[] {
  return Object.values(doc.nodes)
    .filter((n): n is ComponentNode => n.type === 'component')
    .map((c) => ({ component: c, setId: c.parentId && doc.nodes[c.parentId]?.type === 'component-set' ? c.parentId : null, pageId: c.pageId }));
}
