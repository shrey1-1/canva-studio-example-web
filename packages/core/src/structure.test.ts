import { describe, expect, it } from 'vitest';
import { createDocument, createFrame, createRectangle, createVector, createText, vertex } from './factory';
import { nodeBounds, worldMatrix } from './geometry';
import { addNode, DocumentError } from './ops';
import {
  alignNodes,
  distributeNodes,
  groupNodes,
  moveNodes,
  normalizeGroups,
  reorderNodes,
  resizeNode,
  sortByRenderOrder,
  topMostIds,
  ungroupNodes,
} from './structure';
import type { DesignDocument, GroupNode } from './model';

function setup() {
  const doc = createDocument('Test');
  const pageId = doc.pages[0]!.id;
  return { doc, pageId, page: doc.pages[0]! };
}

const worldPos = (doc: DesignDocument, id: string) => {
  const m = worldMatrix(doc, id);
  return { x: Math.round(m[4] * 1000) / 1000, y: Math.round(m[5] * 1000) / 1000 };
};

describe('moveNodes', () => {
  it('reparents into a frame and keeps the on-screen position', () => {
    const { doc, pageId } = setup();
    const frame = createFrame({ pageId, x: 100, y: 50, width: 400, height: 400 });
    const rect = createRectangle({ pageId, x: 150, y: 80 });
    addNode(doc, frame);
    addNode(doc, rect);
    moveNodes(doc, [rect.id], { pageId, parentId: frame.id });
    expect(rect.parentId).toBe(frame.id);
    expect(frame.childIds).toEqual([rect.id]);
    expect(doc.pages[0]!.childIds).toEqual([frame.id]);
    expect({ x: rect.x, y: rect.y }).toEqual({ x: 50, y: 30 });
    expect(worldPos(doc, rect.id)).toEqual({ x: 150, y: 80 });
  });

  it('accounts for a rotated parent', () => {
    const { doc, pageId } = setup();
    const frame = createFrame({ pageId, x: 100, y: 100, width: 200, height: 200 });
    frame.rotation = 90;
    const rect = createRectangle({ pageId, x: 50, y: 150 });
    addNode(doc, frame);
    addNode(doc, rect);
    moveNodes(doc, [rect.id], { pageId, parentId: frame.id });
    expect(worldPos(doc, rect.id)).toEqual({ x: 50, y: 150 });
    expect(rect.rotation).toBe(270); // cancels the parent's 90 degrees
  });

  it('refuses to move a node into its own descendant', () => {
    const { doc, pageId } = setup();
    const outer = createFrame({ pageId });
    const inner = createFrame({ pageId, parentId: outer.id });
    addNode(doc, outer);
    addNode(doc, inner);
    expect(() => moveNodes(doc, [outer.id], { pageId, parentId: inner.id })).toThrow(DocumentError);
  });

  it('inserts at an index relative to the list without the moved nodes', () => {
    const { doc, pageId, page } = setup();
    const [a, b, c] = [0, 1, 2].map(() => createRectangle({ pageId }));
    [a, b, c].forEach((n) => addNode(doc, n!));
    moveNodes(doc, [c!.id], { pageId, parentId: null, index: 0 });
    expect(page.childIds).toEqual([c!.id, a!.id, b!.id]);
  });

  it('moves nodes to another page with their children', () => {
    const { doc, pageId } = setup();
    const other = { id: 'p2', name: 'Page 2', background: '#1E1E1E', childIds: [] };
    doc.pages.push(other);
    const frame = createFrame({ pageId });
    const child = createRectangle({ pageId, parentId: frame.id });
    addNode(doc, frame);
    addNode(doc, child);
    moveNodes(doc, [frame.id], { pageId: 'p2', parentId: null });
    expect(doc.pages[0]!.childIds).toEqual([]);
    expect(other.childIds).toEqual([frame.id]);
    expect(child.pageId).toBe('p2');
  });
});

describe('reorderNodes', () => {
  const make = () => {
    const { doc, pageId, page } = setup();
    const ids = [0, 1, 2, 3].map((i) => {
      const n = createRectangle({ pageId, name: String(i) });
      addNode(doc, n);
      return n.id;
    });
    return { doc, page, ids };
  };

  it('brings forward and sends backward one step', () => {
    const { doc, page, ids } = make();
    reorderNodes(doc, [ids[1]!], 'forward');
    expect(page.childIds).toEqual([ids[0], ids[2], ids[1], ids[3]]);
    reorderNodes(doc, [ids[1]!], 'backward');
    expect(page.childIds).toEqual(ids);
  });

  it('brings to front / sends to back keeping relative order', () => {
    const { doc, page, ids } = make();
    reorderNodes(doc, [ids[0]!, ids[2]!], 'front');
    expect(page.childIds).toEqual([ids[1], ids[3], ids[0], ids[2]]);
    reorderNodes(doc, [ids[3]!], 'back');
    expect(page.childIds[0]).toBe(ids[3]);
  });

  it('does nothing when already at the top', () => {
    const { doc, page, ids } = make();
    reorderNodes(doc, [ids[3]!], 'forward');
    expect(page.childIds).toEqual(ids);
  });
});

describe('groupNodes / ungroupNodes', () => {
  it('wraps nodes in a group sized to their bounds, in place of the top-most', () => {
    const { doc, pageId, page } = setup();
    const a = createRectangle({ pageId, x: 10, y: 20, width: 50, height: 50 });
    const below = createRectangle({ pageId });
    const b = createRectangle({ pageId, x: 100, y: 100, width: 20, height: 30 });
    [a, below, b].forEach((n) => addNode(doc, n));
    const gid = groupNodes(doc, [b.id, a.id]);
    const g = doc.nodes[gid] as GroupNode;
    expect(g.type).toBe('group');
    expect(page.childIds).toEqual([below.id, gid]);
    expect(g.childIds).toEqual([a.id, b.id]);
    expect({ x: g.x, y: g.y, width: g.width, height: g.height }).toEqual({ x: 10, y: 20, width: 110, height: 110 });
    expect(worldPos(doc, b.id)).toEqual({ x: 100, y: 100 });
  });

  it('ungroup puts children back where the group was, keeping positions', () => {
    const { doc, pageId, page } = setup();
    const a = createRectangle({ pageId, x: 10, y: 20 });
    const b = createRectangle({ pageId, x: 200, y: 20 });
    addNode(doc, a);
    addNode(doc, b);
    const gid = groupNodes(doc, [a.id, b.id]);
    doc.nodes[gid]!.rotation = 0;
    const released = ungroupNodes(doc, [gid]);
    expect(released).toEqual([a.id, b.id]);
    expect(doc.nodes[gid]).toBeUndefined();
    expect(page.childIds).toEqual([a.id, b.id]);
    expect(worldPos(doc, a.id)).toEqual({ x: 10, y: 20 });
    expect(a.parentId).toBeNull();
  });

  it('frame selection creates a transparent, non-clipping frame', () => {
    const { doc, pageId } = setup();
    const a = createRectangle({ pageId, x: 5, y: 5 });
    addNode(doc, a);
    const fid = groupNodes(doc, [a.id], 'frame');
    const f = doc.nodes[fid]!;
    expect(f.type).toBe('frame');
    expect(f.fills).toEqual([]);
    expect(f.type === 'frame' && f.clipContent).toBe(false);
  });
});

describe('normalizeGroups', () => {
  it('refits a group when a child moves, without moving anything on screen', () => {
    const { doc, pageId } = setup();
    const a = createRectangle({ pageId, x: 0, y: 0, width: 10, height: 10 });
    const b = createRectangle({ pageId, x: 50, y: 50, width: 10, height: 10 });
    addNode(doc, a);
    addNode(doc, b);
    const gid = groupNodes(doc, [a.id, b.id]);
    a.x = -20; // move child left of the group's origin
    normalizeGroups(doc);
    const g = doc.nodes[gid]!;
    expect({ x: g.x, width: g.width }).toEqual({ x: -20, width: 80 });
    expect(worldPos(doc, a.id)).toEqual({ x: -20, y: 0 });
    expect(worldPos(doc, b.id)).toEqual({ x: 50, y: 50 });
  });

  it('deletes groups that became empty', () => {
    const { doc, pageId, page } = setup();
    const a = createRectangle({ pageId });
    addNode(doc, a);
    const gid = groupNodes(doc, [a.id]);
    (doc.nodes[gid] as GroupNode).childIds = [];
    delete doc.nodes[a.id];
    normalizeGroups(doc);
    expect(doc.nodes[gid]).toBeUndefined();
    expect(page.childIds).toEqual([]);
  });
});

describe('resizeNode', () => {
  it('scales vector paths', () => {
    const { doc, pageId } = setup();
    const v = createVector({ pageId, width: 10, height: 10, closed: false, vertices: [vertex(0, 0), vertex(10, 10, { inX: -5 })] });
    addNode(doc, v);
    resizeNode(doc, v.id, 20, 30);
    expect(v.vertices[1]).toEqual({ x: 20, y: 30, inX: -10, inY: 0, outX: 0, outY: 0 });
  });

  it('scales group children', () => {
    const { doc, pageId } = setup();
    const a = createRectangle({ pageId, x: 0, y: 0, width: 10, height: 10 });
    const b = createRectangle({ pageId, x: 10, y: 0, width: 10, height: 10 });
    addNode(doc, a);
    addNode(doc, b);
    const gid = groupNodes(doc, [a.id, b.id]);
    resizeNode(doc, gid, 40, 10);
    expect({ x: b.x, width: b.width }).toEqual({ x: 20, width: 20 });
  });

  it('switches auto-width text to fixed width when resized horizontally', () => {
    const { doc, pageId } = setup();
    const t = createText({ pageId, characters: 'Hi' });
    t.width = 30;
    addNode(doc, t);
    resizeNode(doc, t.id, 80, t.height);
    expect(t.autoResize).toBe('height');
    resizeNode(doc, t.id, 80, 100);
    expect(t.autoResize).toBe('none');
  });
});

describe('align / distribute', () => {
  it('aligns several nodes to the selection edge', () => {
    const { doc, pageId } = setup();
    const a = createRectangle({ pageId, x: 10, y: 0, width: 10, height: 10 });
    const b = createRectangle({ pageId, x: 40, y: 30, width: 20, height: 10 });
    addNode(doc, a);
    addNode(doc, b);
    alignNodes(doc, [a.id, b.id], 'right');
    expect(a.x).toBe(50);
    expect(b.x).toBe(40);
    alignNodes(doc, [a.id, b.id], 'top');
    expect(b.y).toBe(0);
  });

  it('centres a single node in its parent frame', () => {
    const { doc, pageId } = setup();
    const f = createFrame({ pageId, x: 100, y: 100, width: 200, height: 100 });
    const r = createRectangle({ pageId, parentId: f.id, width: 50, height: 50 });
    addNode(doc, f);
    addNode(doc, r);
    expect(alignNodes(doc, [r.id], 'h-center')).toBe(true);
    expect(r.x).toBe(75);
  });

  it('cannot align a single top-level node', () => {
    const { doc, pageId } = setup();
    const r = createRectangle({ pageId });
    addNode(doc, r);
    expect(alignNodes(doc, [r.id], 'left')).toBe(false);
  });

  it('distributes horizontal gaps evenly', () => {
    const { doc, pageId } = setup();
    const a = createRectangle({ pageId, x: 0, width: 10, height: 10 });
    const b = createRectangle({ pageId, x: 15, width: 10, height: 10 });
    const c = createRectangle({ pageId, x: 90, width: 10, height: 10 });
    [a, b, c].forEach((n) => addNode(doc, n));
    distributeNodes(doc, [a.id, b.id, c.id], 'horizontal');
    expect(b.x).toBe(45);
    expect(nodeBounds(doc, c.id).x).toBe(90);
  });
});

describe('helpers', () => {
  it('topMostIds drops descendants of selected nodes', () => {
    const { doc, pageId } = setup();
    const f = createFrame({ pageId });
    const r = createRectangle({ pageId, parentId: f.id });
    addNode(doc, f);
    addNode(doc, r);
    expect(topMostIds(doc, [r.id, f.id, 'missing'])).toEqual([f.id]);
  });

  it('sortByRenderOrder orders across nesting levels', () => {
    const { doc, pageId } = setup();
    const f = createFrame({ pageId });
    const inner = createRectangle({ pageId, parentId: f.id });
    const top = createRectangle({ pageId });
    addNode(doc, f);
    addNode(doc, inner);
    addNode(doc, top);
    expect(sortByRenderOrder(doc, [top.id, inner.id, f.id])).toEqual([f.id, inner.id, top.id]);
  });
});
