import { beforeEach, describe, expect, it } from 'vitest';
import {
  combineAsVariants,
  createComponent,
  createInstance,
  detachInstance,
  resetOverrides,
  setInstanceVariant,
  variantOptions,
  wouldCreateCycle,
} from './components';
import { createDocument, createFrame, createRectangle, createText, solid } from './factory';
import { finalizeDocument } from './finalize';
import { DEFAULT_AUTO_LAYOUT } from './layout';
import { migrateDocument } from './migrate';
import type { ComponentNode, DesignDocument, FrameNode, InstanceNode, SceneNode, TextNode } from './model';
import { addNode, deleteNodes, DocumentError, updateNode } from './ops';
import { moveNodes, resizeNode } from './structure';
import { isValidDocument } from './validate';
import { addCollection, addMode, addVariable, bindVariable, deleteVariable, setVariableValue } from './variables';

const measure = (n: TextNode, width: number | null) => ({ width: width ?? n.characters.length * 8, height: n.fontSize * n.lineHeight });
const fin = (doc: DesignDocument) => finalizeDocument(doc, measure);

let doc: DesignDocument;
let pageId: string;
beforeEach(() => {
  doc = createDocument('P3');
  pageId = doc.pages[0]!.id;
});

/** A 100x40 "Button" component with a background rect and a label. */
function makeButton() {
  const frame = createFrame({ pageId, x: 0, y: 0, width: 100, height: 40, name: 'Button' });
  const bg = createRectangle({ pageId, parentId: frame.id, width: 100, height: 40, name: 'Bg' });
  const label = createText({ pageId, parentId: frame.id, x: 10, y: 10, characters: 'OK', name: 'Label' });
  [frame, bg, label].forEach((n) => addNode(doc, n));
  const id = createComponent(doc, [frame.id]);
  fin(doc);
  return { id, bg, label };
}
const childBy = (parent: SceneNode, name: string) =>
  (parent as FrameNode).childIds.map((c) => doc.nodes[c]!).find((n) => n.name === name)!;

describe('components and instances', () => {
  it('converts a frame into a component and creates a synced instance', () => {
    const { id } = makeButton();
    expect(doc.nodes[id]!.type).toBe('component');
    const inst = createInstance(doc, id, { pageId, parentId: null, x: 300, y: 0 });
    fin(doc);
    const node = doc.nodes[inst] as InstanceNode;
    expect(node.childIds).toHaveLength(2);
    expect(childBy(node, 'Bg').componentNodeId).toBeDefined();
    expect(isValidDocument(doc)).toBe(true);
  });

  it('propagates component edits but keeps instance overrides', () => {
    const { id, bg, label } = makeButton();
    const inst = createInstance(doc, id, { pageId, parentId: null, x: 300, y: 0 });
    fin(doc);
    const instLabel = childBy(doc.nodes[inst]!, 'Label');
    updateNode(doc, instLabel.id, { characters: 'Buy now' });
    expect(instLabel.overrides).toEqual(['characters']);

    updateNode(doc, bg.id, { fills: [solid('#FF0000')] });
    updateNode(doc, label.id, { characters: 'Cancel', fontSize: 20 });
    fin(doc);
    expect(childBy(doc.nodes[inst]!, 'Bg').fills[0]!.color).toBe('#FF0000');
    const l = childBy(doc.nodes[inst]!, 'Label') as TextNode;
    expect(l.characters).toBe('Buy now'); // overridden
    expect(l.fontSize).toBe(20); // not overridden -> follows

    resetOverrides(doc, inst);
    fin(doc);
    expect((childBy(doc.nodes[inst]!, 'Label') as TextNode).characters).toBe('Cancel');
  });

  it('adds and removes instance layers when the component changes structure', () => {
    const { id, bg } = makeButton();
    const inst = createInstance(doc, id, { pageId, parentId: null, x: 300, y: 0 });
    fin(doc);
    addNode(doc, createRectangle({ pageId, parentId: id, name: 'Badge' }));
    deleteNodes(doc, [bg.id]);
    fin(doc);
    const names = (doc.nodes[inst] as InstanceNode).childIds.map((c) => doc.nodes[c]!.name);
    expect(names).toEqual(['Label', 'Badge']);
  });

  it('protects instance structure', () => {
    const { id } = makeButton();
    const inst = createInstance(doc, id, { pageId, parentId: null, x: 300, y: 0 });
    fin(doc);
    const child = (doc.nodes[inst] as InstanceNode).childIds[0]!;
    expect(() => deleteNodes(doc, [child])).toThrow(DocumentError);
    expect(() => moveNodes(doc, [child], { pageId, parentId: null })).toThrow(DocumentError);
    expect(() => addNode(doc, createRectangle({ pageId, parentId: inst }))).toThrow(DocumentError);
    expect(() => deleteNodes(doc, [inst])).not.toThrow(); // the whole instance can go
  });

  it('applies constraints when an instance is resized', () => {
    const { id, label } = makeButton();
    updateNode(doc, label.id, { constraints: { horizontal: 'right', vertical: 'top' } });
    const inst = createInstance(doc, id, { pageId, parentId: null, x: 300, y: 0 });
    fin(doc);
    resizeNode(doc, inst, 200, 40);
    fin(doc);
    expect(childBy(doc.nodes[inst]!, 'Label').x).toBe(110);
    fin(doc); // stable: a second pass changes nothing
    expect(childBy(doc.nodes[inst]!, 'Label').x).toBe(110);
  });

  it('detaches into a plain frame and detaches automatically when the component is deleted', () => {
    const { id } = makeButton();
    const a = createInstance(doc, id, { pageId, parentId: null, x: 300, y: 0 });
    const b = createInstance(doc, id, { pageId, parentId: null, x: 500, y: 0 });
    fin(doc);
    detachInstance(doc, a);
    expect(doc.nodes[a]!.type).toBe('frame');
    expect(childBy(doc.nodes[a]!, 'Bg').componentNodeId).toBeUndefined();
    deleteNodes(doc, [id]);
    fin(doc);
    expect(doc.nodes[b]!.type).toBe('frame');
    expect(isValidDocument(doc)).toBe(true);
  });

  it('refuses instances that would contain themselves', () => {
    const { id } = makeButton();
    expect(wouldCreateCycle(doc, id, id)).toBe(true);
    expect(() => createInstance(doc, id, { pageId, parentId: id, x: 0, y: 0 })).toThrow(DocumentError);
  });

  it('nested instances inherit the outer component overrides', () => {
    const { id: button } = makeButton();
    const card = createFrame({ pageId, x: 0, y: 200, width: 200, height: 100, name: 'Card' });
    addNode(doc, card);
    const cardId = createComponent(doc, [card.id]);
    const nested = createInstance(doc, button, { pageId, parentId: cardId, x: 10, y: 10 });
    fin(doc);
    updateNode(doc, childBy(doc.nodes[nested]!, 'Label').id, { characters: 'Card CTA' });
    const outer = createInstance(doc, cardId, { pageId, parentId: null, x: 400, y: 200 });
    fin(doc);
    const innerCopy = (doc.nodes[outer] as InstanceNode).childIds.map((c) => doc.nodes[c]!)[0]!;
    expect(innerCopy.type).toBe('instance');
    expect((childBy(innerCopy, 'Label') as TextNode).characters).toBe('Card CTA');
  });
});

describe('variants', () => {
  it('combines components into a set and switches an instance between variants', () => {
    const { id: primary } = makeButton();
    const f2 = createFrame({ pageId, x: 0, y: 100, width: 120, height: 48, name: 'Button' });
    addNode(doc, f2);
    const secondary = createComponent(doc, [f2.id]);
    const setId = combineAsVariants(doc, [primary, secondary]);
    expect(doc.nodes[setId]!.type).toBe('component-set');
    (doc.nodes[secondary] as ComponentNode).variantProps = { Property: 'Secondary' };
    expect(variantOptions(doc, setId)).toEqual({ Property: ['Default', 'Secondary'] });
    const inst = createInstance(doc, primary, { pageId, parentId: null, x: 400, y: 0 });
    fin(doc);
    expect(setInstanceVariant(doc, inst, 'Property', 'Secondary')).toBe(true);
    fin(doc);
    const node = doc.nodes[inst] as InstanceNode;
    expect(node.componentId).toBe(secondary);
    expect({ w: node.width, h: node.height }).toEqual({ w: 120, h: 48 });
  });
});

describe('auto layout', () => {
  function stack(direction: 'horizontal' | 'vertical') {
    const f = createFrame({ pageId, width: 300, height: 300 });
    f.layout = { ...DEFAULT_AUTO_LAYOUT, direction, gap: 10, paddingTop: 5, paddingRight: 5, paddingBottom: 5, paddingLeft: 5 };
    addNode(doc, f);
    const a = createRectangle({ pageId, parentId: f.id, width: 50, height: 20 });
    const b = createRectangle({ pageId, parentId: f.id, width: 70, height: 30 });
    addNode(doc, a);
    addNode(doc, b);
    return { f, a, b };
  }

  it('stacks children with padding and gap', () => {
    const { a, b } = stack('horizontal');
    fin(doc);
    expect([a.x, a.y, b.x, b.y]).toEqual([5, 5, 65, 5]);
  });

  it('hugs its content and fills remaining space', () => {
    const { f, a, b } = stack('vertical');
    f.sizing = { horizontal: 'hug', vertical: 'hug' };
    fin(doc);
    expect({ w: f.width, h: f.height }).toEqual({ w: 80, h: 70 });
    f.sizing = { horizontal: 'fixed', vertical: 'fixed' };
    f.width = 200;
    f.height = 200;
    a.sizing = { horizontal: 'fill', vertical: 'fill' };
    fin(doc);
    expect({ w: a.width, h: a.height }).toEqual({ w: 190, h: 150 });
    expect(b.y).toBe(165);
  });

  it('aligns, distributes with space-between, and respects min/max', () => {
    const { f, a, b } = stack('horizontal');
    f.layout = { ...f.layout!, primaryAlign: 'space-between', counterAlign: 'center' };
    fin(doc);
    expect(b.x + b.width).toBe(295);
    expect(a.y).toBe(140);
    f.sizing = { horizontal: 'hug', vertical: 'fixed' };
    f.minWidth = 400;
    fin(doc);
    expect(f.width).toBe(400);
  });
});

describe('constraints on frame resize', () => {
  it('moves and stretches children by their constraints', () => {
    const f = createFrame({ pageId, width: 200, height: 100 });
    addNode(doc, f);
    const right = createRectangle({ pageId, parentId: f.id, x: 150, y: 10, width: 40, height: 20 });
    right.constraints = { horizontal: 'right', vertical: 'top' };
    const stretch = createRectangle({ pageId, parentId: f.id, x: 10, y: 50, width: 180, height: 20 });
    stretch.constraints = { horizontal: 'left-right', vertical: 'bottom' };
    addNode(doc, right);
    addNode(doc, stretch);
    resizeNode(doc, f.id, 300, 150);
    expect(right.x).toBe(250);
    expect({ w: stretch.width, y: stretch.y }).toEqual({ w: 280, y: 100 });
  });
});

describe('variables', () => {
  it('binds properties, follows modes per frame, and releases deleted variables', () => {
    const col = addCollection(doc, 'Theme');
    const dark = addMode(doc, col.id, 'Dark');
    const brand = addVariable(doc, col.id, 'color', 'Brand');
    setVariableValue(doc, brand.id, col.defaultModeId, '#ff0000');
    setVariableValue(doc, brand.id, dark, '#00FF00');
    const frame = createFrame({ pageId, width: 100, height: 100 });
    const rect = createRectangle({ pageId, parentId: frame.id });
    addNode(doc, frame);
    addNode(doc, rect);
    bindVariable(doc, rect.id, 'fill', brand.id);
    fin(doc);
    expect(rect.fills.at(-1)!.color).toBe('#FF0000');
    frame.variableModes = { [col.id]: dark };
    fin(doc);
    expect(rect.fills.at(-1)!.color).toBe('#00FF00');
    expect(() => bindVariable(doc, rect.id, 'opacity', brand.id)).toThrow(/cannot drive/);
    expect(() => setVariableValue(doc, brand.id, dark, 'red')).toThrow(DocumentError);
    deleteVariable(doc, brand.id);
    fin(doc);
    expect(rect.bindings).toBeUndefined();
    expect(isValidDocument(doc)).toBe(true);
  });
});

describe('schema v3 migration', () => {
  it('upgrades a v2 file with defaults for the new fields', () => {
    const r = createRectangle({ pageId });
    addNode(doc, r);
    const v2 = JSON.parse(JSON.stringify(doc));
    v2.schemaVersion = 2;
    delete v2.variables;
    delete v2.variableCollections;
    for (const n of Object.values(v2.nodes) as Record<string, unknown>[]) {
      delete n.constraints;
      delete n.sizing;
      delete n.minWidth;
    }
    const out = migrateDocument(v2);
    expect(out.schemaVersion).toBe(3);
    expect(out.nodes[r.id]!.constraints).toEqual({ horizontal: 'left', vertical: 'top' });
    expect(out.variables).toEqual([]);
  });
});
