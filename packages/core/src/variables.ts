/**
 * Variables: named, typed values grouped in collections with modes (e.g. Light / Dark).
 * Layers bind properties to variables; `applyVariables` writes each bound property from the
 * variable's value in the mode chosen by the nearest frame (or the collection default).
 */
import { createId, solid } from './factory';
import { round } from './geometry';
import {
  hasCornerRadius,
  isFrameLike,
  type BindableField,
  type CollectionId,
  type DesignDocument,
  type ModeId,
  type NodeId,
  type SceneNode,
  type Variable,
  type VariableCollection,
  type VariableId,
  type VariableType,
  type VariableValue,
} from './model';
import { DocumentError, getNode, trackOverrides } from './ops';
import { resizeNode } from './structure';

export const BINDABLE_TYPES: Record<BindableField, VariableType> = {
  fill: 'color',
  stroke: 'color',
  opacity: 'number',
  cornerRadius: 'number',
  width: 'number',
  height: 'number',
  gap: 'number',
  padding: 'number',
  fontSize: 'number',
  characters: 'string',
  visible: 'boolean',
};

/** Whether a property can be bound on this kind of layer. */
export function canBind(node: SceneNode, field: BindableField): boolean {
  switch (field) {
    case 'fill':
      return node.type !== 'group' && node.type !== 'line' && !(node.type === 'vector' && !node.closed);
    case 'stroke':
      return node.type !== 'group';
    case 'cornerRadius':
      return hasCornerRadius(node);
    case 'gap':
    case 'padding':
      return isFrameLike(node) && node.layout !== null;
    case 'fontSize':
    case 'characters':
      return node.type === 'text';
    case 'height':
      return node.type !== 'line';
    default:
      return true;
  }
}

const DEFAULTS: Record<VariableType, VariableValue> = { color: '#3B82F6', number: 0, string: '', boolean: true };

export function isValidValue(type: VariableType, value: unknown): value is VariableValue {
  switch (type) {
    case 'color':
      return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string' && value.length <= 10_000;
    case 'boolean':
      return typeof value === 'boolean';
  }
}

const getCollection = (doc: DesignDocument, id: CollectionId) => {
  const c = doc.variableCollections.find((x) => x.id === id);
  if (!c) throw new DocumentError('Variable collection not found');
  return c;
};

export const getVariable = (doc: DesignDocument, id: VariableId): Variable => {
  const v = doc.variables.find((x) => x.id === id);
  if (!v) throw new DocumentError('Variable not found');
  return v;
};

const requireName = (name: string) => {
  const t = name.trim();
  if (!t) throw new DocumentError('Name cannot be empty');
  return t.slice(0, 200);
};

export function addCollection(doc: DesignDocument, name?: string): VariableCollection {
  const modeId = createId();
  const collection: VariableCollection = {
    id: createId(),
    name: name ?? `Collection ${doc.variableCollections.length + 1}`,
    modes: [{ id: modeId, name: 'Mode 1' }],
    defaultModeId: modeId,
  };
  doc.variableCollections.push(collection);
  return collection;
}

export function renameCollection(doc: DesignDocument, id: CollectionId, name: string): void {
  getCollection(doc, id).name = requireName(name);
}

/** Deletes a collection and its variables (bindings to them are released by applyVariables). */
export function deleteCollection(doc: DesignDocument, id: CollectionId): void {
  getCollection(doc, id);
  doc.variableCollections = doc.variableCollections.filter((c) => c.id !== id);
  doc.variables = doc.variables.filter((v) => v.collectionId !== id);
}

/** Adds a mode; every variable starts with the default mode's value. */
export function addMode(doc: DesignDocument, collectionId: CollectionId, name?: string): ModeId {
  const c = getCollection(doc, collectionId);
  const id = createId();
  c.modes.push({ id, name: name ?? `Mode ${c.modes.length + 1}` });
  for (const v of doc.variables) {
    if (v.collectionId === collectionId) v.valuesByMode[id] = v.valuesByMode[c.defaultModeId] ?? DEFAULTS[v.type];
  }
  return id;
}

export function renameMode(doc: DesignDocument, collectionId: CollectionId, modeId: ModeId, name: string): void {
  const mode = getCollection(doc, collectionId).modes.find((m) => m.id === modeId);
  if (!mode) throw new DocumentError('Mode not found');
  mode.name = requireName(name);
}

export function deleteMode(doc: DesignDocument, collectionId: CollectionId, modeId: ModeId): void {
  const c = getCollection(doc, collectionId);
  if (c.modes.length <= 1) throw new DocumentError('A collection needs at least one mode');
  c.modes = c.modes.filter((m) => m.id !== modeId);
  if (c.defaultModeId === modeId) c.defaultModeId = c.modes[0]!.id;
  for (const v of doc.variables) if (v.collectionId === collectionId) delete v.valuesByMode[modeId];
}

export function addVariable(doc: DesignDocument, collectionId: CollectionId, type: VariableType, name?: string): Variable {
  const c = getCollection(doc, collectionId);
  const count = doc.variables.filter((v) => v.collectionId === collectionId).length;
  const variable: Variable = {
    id: createId(),
    name: name ?? `${type} ${count + 1}`,
    collectionId,
    type,
    valuesByMode: Object.fromEntries(c.modes.map((m) => [m.id, DEFAULTS[type]])),
  };
  doc.variables.push(variable);
  return variable;
}

export function renameVariable(doc: DesignDocument, id: VariableId, name: string): void {
  getVariable(doc, id).name = requireName(name);
}

export function setVariableValue(doc: DesignDocument, id: VariableId, modeId: ModeId, value: VariableValue): void {
  const v = getVariable(doc, id);
  if (!getCollection(doc, v.collectionId).modes.some((m) => m.id === modeId)) throw new DocumentError('Mode not found');
  const normalized = v.type === 'color' && typeof value === 'string' ? value.toUpperCase() : value;
  if (!isValidValue(v.type, normalized)) throw new DocumentError(`Value is not a valid ${v.type}`);
  v.valuesByMode[modeId] = normalized;
}

export function deleteVariable(doc: DesignDocument, id: VariableId): void {
  getVariable(doc, id);
  doc.variables = doc.variables.filter((v) => v.id !== id);
}

export function bindVariable(doc: DesignDocument, nodeId: NodeId, field: BindableField, variableId: VariableId): void {
  const node = getNode(doc, nodeId);
  const v = getVariable(doc, variableId);
  if (BINDABLE_TYPES[field] !== v.type) throw new DocumentError(`A ${v.type} variable cannot drive ${field}`);
  if (!canBind(node, field)) throw new DocumentError(`This layer has no ${field} to bind`);
  node.bindings = { ...node.bindings, [field]: variableId };
  trackOverrides(node, ['bindings']);
}

export function unbindVariable(doc: DesignDocument, nodeId: NodeId, field: BindableField): void {
  const node = getNode(doc, nodeId);
  if (!node.bindings?.[field]) return;
  const next = { ...node.bindings };
  delete next[field];
  if (Object.keys(next).length) node.bindings = next;
  else delete node.bindings;
  trackOverrides(node, ['bindings']);
}

/** The mode in effect for a collection at a layer: the nearest frame's choice, else the default. */
export function effectiveMode(doc: DesignDocument, nodeId: NodeId | null, collection: VariableCollection): ModeId {
  let current = nodeId ? doc.nodes[nodeId] : undefined;
  while (current) {
    if (isFrameLike(current)) {
      const chosen = current.variableModes?.[collection.id];
      if (chosen && collection.modes.some((m) => m.id === chosen)) return chosen;
    }
    current = current.parentId ? doc.nodes[current.parentId] : undefined;
  }
  return collection.defaultModeId;
}

export function resolveValue(doc: DesignDocument, variable: Variable, nodeId: NodeId | null): VariableValue {
  const collection = doc.variableCollections.find((c) => c.id === variable.collectionId);
  if (!collection) return DEFAULTS[variable.type];
  const mode = effectiveMode(doc, nodeId, collection);
  return variable.valuesByMode[mode] ?? variable.valuesByMode[collection.defaultModeId] ?? DEFAULTS[variable.type];
}

/** Sizes from variables are clamped to what a document may store (see validate.ts). */
const size = (value: VariableValue) => Math.max(0, Math.min(1_000_000, Number(value) || 0));

function writeField(doc: DesignDocument, node: SceneNode, field: BindableField, value: VariableValue) {
  switch (field) {
    case 'fill': {
      const color = String(value);
      const top = node.fills[node.fills.length - 1];
      if (!top) node.fills = [solid(color)];
      else if (top.color !== color) node.fills = [...node.fills.slice(0, -1), { ...top, color }];
      return;
    }
    case 'stroke': {
      const color = String(value);
      const top = node.strokes[node.strokes.length - 1];
      if (!top) node.strokes = [{ color, width: 1, opacity: 1, visible: true }];
      else if (top.color !== color) node.strokes = [...node.strokes.slice(0, -1), { ...top, color }];
      return;
    }
    case 'opacity': {
      // Opacity variables are percentages (0-100), like the inspector field.
      const o = round(Math.max(0, Math.min(100, Number(value))) / 100, 4);
      if (node.opacity !== o) node.opacity = o;
      return;
    }
    case 'cornerRadius':
      if (hasCornerRadius(node) && node.cornerRadius !== size(value)) node.cornerRadius = size(value);
      return;
    case 'width':
    case 'height': {
      const n = size(value);
      const w = field === 'width' ? n : node.width;
      const h = field === 'height' ? n : node.height;
      if (w !== node.width || h !== node.height) resizeNode(doc, node.id, w, h, { manual: false });
      return;
    }
    case 'gap':
      if (isFrameLike(node) && node.layout && node.layout.gap !== size(value)) node.layout = { ...node.layout, gap: size(value) };
      return;
    case 'padding': {
      const p = size(value);
      if (isFrameLike(node) && node.layout && [node.layout.paddingTop, node.layout.paddingRight, node.layout.paddingBottom, node.layout.paddingLeft].some((v) => v !== p)) {
        node.layout = { ...node.layout, paddingTop: p, paddingRight: p, paddingBottom: p, paddingLeft: p };
      }
      return;
    }
    case 'fontSize':
      if (node.type === 'text') {
        const size = Math.max(1, Math.min(2000, Number(value)));
        if (node.fontSize !== size) node.fontSize = size;
      }
      return;
    case 'characters':
      if (node.type === 'text' && node.characters !== String(value)) node.characters = String(value);
      return;
    case 'visible':
      if (node.visible !== Boolean(value)) node.visible = Boolean(value);
      return;
  }
}

/** Writes every bound property from its variable. Bindings to deleted variables are released. */
export function applyVariables(doc: DesignDocument): void {
  const byId = new Map(doc.variables.map((v) => [v.id, v]));
  for (const node of Object.values(doc.nodes)) {
    if (!node.bindings) continue;
    for (const [field, variableId] of Object.entries(node.bindings) as [BindableField, VariableId][]) {
      const variable = byId.get(variableId);
      if (!variable || BINDABLE_TYPES[field] !== variable.type || !canBind(node, field)) {
        const next: Partial<Record<BindableField, VariableId>> = { ...node.bindings };
        delete next[field];
        if (Object.keys(next).length) node.bindings = next;
        else delete node.bindings;
        continue;
      }
      writeField(doc, node, field, resolveValue(doc, variable, node.id));
    }
  }
  // Mode choices for deleted collections are dropped.
  const collections = new Set(doc.variableCollections.map((c) => c.id));
  for (const node of Object.values(doc.nodes)) {
    if (!isFrameLike(node) || !node.variableModes) continue;
    if (Object.keys(node.variableModes).some((c) => !collections.has(c))) {
      const kept = Object.fromEntries(Object.entries(node.variableModes).filter(([c]) => collections.has(c)));
      if (Object.keys(kept).length) node.variableModes = kept;
      else delete node.variableModes;
    }
  }
}
