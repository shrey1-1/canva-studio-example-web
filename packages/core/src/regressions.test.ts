import { describe, it, expect } from 'vitest';
import { enablePatches, produceWithPatches } from 'immer';
import { createComponent, createInstance } from './components';
import { createDocument, createFrame, createRectangle, createVector, createGroup, createText } from './factory';
import { finalizeDocument } from './finalize';
import { DEFAULT_AUTO_LAYOUT } from './layout';
import { addNode, updateNode } from './ops';
import { resizeNode } from './structure';
import { addCollection, addVariable, bindVariable, setVariableValue } from './variables';
enablePatches();
const measure = (n: any, width: number | null) => ({ width: width ?? n.characters.length * 8, height: n.fontSize * n.lineHeight });
const fin = (d: any) => finalizeDocument(d, measure);
/** Patches produced by a second, no-op finalize (must be none: otherwise every edit adds undo noise). */
const noop = (d: any) => (produceWithPatches as any)(d, (x: any) => fin(x))[1] as { path: unknown[] }[];
function setup() { const doc = createDocument('x'); return { doc, pageId: doc.pages[0]!.id }; }

// Regression tests for the Phase 3 code review findings.
describe('finalize is idempotent and stable', () => {
  it('deep nesting converges', () => {
    const { doc, pageId } = setup();
    let prev: string | null = null;
    const comps: string[] = [];
    for (let i = 0; i < 6; i++) {
      const f = createFrame({ pageId, x: i * 500, y: 0, width: 100, height: 100, name: 'C' + i });
      addNode(doc, f);
      const r = createRectangle({ pageId, parentId: f.id, width: 10, height: 10, name: 'r' + i });
      addNode(doc, r);
      if (prev) createInstance(doc, prev, { pageId, parentId: f.id, x: 20, y: 20 });
      const id = createComponent(doc, [f.id]);
      fin(doc); comps.push(id); prev = id;
    }
    createInstance(doc, prev!, { pageId, parentId: null, x: 0, y: 900 });
    fin(doc);
    // edit deepest component
    const r0 = Object.values(doc.nodes).find((n: any) => n.name === 'r0')!;
    const [d2] = (produceWithPatches as any)(doc, (d: any) => { d.nodes[r0.id].width = 55; fin(d); });
    const p = noop(d2);
    expect(p).toHaveLength(0);
    const widths = Object.values(d2.nodes).filter((n: any) => n.name === 'r0').map((n: any) => n.width);
    expect(new Set(widths)).toEqual(new Set([55]));
  });
  it('nested instance left-right', () => {
    const { doc, pageId } = setup();
    const f = createFrame({ pageId, width: 50, height: 50, name: 'D' }); addNode(doc, f);
    const d = createComponent(doc, [f.id]); fin(doc);
    const b = createFrame({ pageId, x: 300, width: 200, height: 100, name: 'B' }); addNode(doc, b);
    const n = createInstance(doc, d, { pageId, parentId: b.id, x: 10, y: 10 });
    updateNode(doc, n, { constraints: { horizontal: 'left-right', vertical: 'top' } } as any);
    const bid = createComponent(doc, [b.id]); fin(doc);
    const i = createInstance(doc, bid, { pageId, parentId: null, x: 0, y: 500 }); fin(doc);
    resizeNode(doc, i, 400, 100); fin(doc);
    const nested = doc.nodes[(doc.nodes[i] as any).childIds[0]] as any;
    expect(nested.width).toBe(250);
    expect(noop(doc)).toHaveLength(0);
  });
  it('negative gap variable', () => {
    const { doc, pageId } = setup();
    const f = createFrame({ pageId, width: 200, height: 100 }); addNode(doc, f);
    updateNode(doc, f.id, { layout: { ...DEFAULT_AUTO_LAYOUT } } as any);
    const c = addCollection(doc); const v = addVariable(doc, c.id, 'number');
    setVariableValue(doc, v.id, c.defaultModeId, -5);
    bindVariable(doc, f.id, 'gap', v.id); fin(doc);
    expect((doc.nodes[f.id] as any).layout.gap).toBe(0);
    expect(noop(doc)).toHaveLength(0);
  });
  it('fill instance with scale vector', () => {
    const { doc, pageId } = setup();
    const f = createFrame({ pageId, width: 100, height: 40, name: 'Btn' }); addNode(doc, f);
    const vec = createVector({ pageId, parentId: f.id, x: 0, y: 0, width: 20, height: 20, closed: true, vertices: [{x:0,y:0,inX:0,inY:0,outX:0,outY:0},{x:20,y:20,inX:0,inY:0,outX:0,outY:0},{x:0,y:20,inX:0,inY:0,outX:0,outY:0}] } as any);
    addNode(doc, vec);
    updateNode(doc, vec.id, { constraints: { horizontal: 'scale', vertical: 'top' } } as any);
    const comp = createComponent(doc, [f.id]); fin(doc);
    const col = createFrame({ pageId, x: 500, width: 300, height: 300 }); addNode(doc, col);
    updateNode(doc, col.id, { layout: { ...DEFAULT_AUTO_LAYOUT } } as any);
    const inst = createInstance(doc, comp, { pageId, parentId: col.id, x: 0, y: 0 });
    updateNode(doc, inst, { sizing: { horizontal: 'fill', vertical: 'fixed' } } as any);
    fin(doc); fin(doc);
    const p = noop(doc);
    expect(p.map((x) => x.path)).toEqual([]);
  });
  it('group fill in auto layout', () => {
    const { doc, pageId } = setup();
    const col = createFrame({ pageId, width: 300, height: 300 }); addNode(doc, col);
    updateNode(doc, col.id, { layout: { ...DEFAULT_AUTO_LAYOUT } } as any);
    const g = createGroup({ pageId, parentId: col.id, width: 50, height: 20 }); addNode(doc, g);
    const t = createText({ pageId, parentId: g.id, characters: 'hello' }); addNode(doc, t);
    fin(doc);
    updateNode(doc, g.id, { sizing: { horizontal: 'fill', vertical: 'fixed' } } as any);
    fin(doc);
    const tt = doc.nodes[t.id] as any;
    expect(tt.autoResize).toBe('width-and-height');
    expect(tt.sizing).toEqual({ horizontal: 'hug', vertical: 'hug' });
  });
  it('indirect cycle churn', () => {
    const { doc, pageId } = setup();
    const a = createFrame({ pageId, width: 100, height: 100, name: 'A' }); addNode(doc, a);
    const aid = createComponent(doc, [a.id]); fin(doc);
    const b = createFrame({ pageId, x: 300, width: 100, height: 100, name: 'B' }); addNode(doc, b);
    createInstance(doc, aid, { pageId, parentId: b.id, x: 0, y: 0 });
    const bid = createComponent(doc, [b.id]); fin(doc);
    // simulate paste of a frame wrapping an instance of B into A (nested, not root)
    const w = createFrame({ pageId, parentId: aid, width: 50, height: 50 }); addNode(doc, w);
    const ib = { ...JSON.parse(JSON.stringify(doc.nodes[bid])), id: 'ib1', type: 'instance', componentId: bid, parentId: w.id, childIds: [] } as any;
    delete ib.description; delete ib.variantProps;
    addNode(doc, ib); fin(doc);
    expect(noop(doc)).toHaveLength(0);
    const count = Object.keys(doc.nodes).length;
    fin(doc);
    expect(Object.keys(doc.nodes)).toHaveLength(count);
  });
});
