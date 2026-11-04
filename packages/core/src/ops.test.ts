import { describe, expect, it } from 'vitest';
import { createDocument, createFrame, createRectangle } from './factory';
import {
  DocumentError,
  absolutePosition,
  addNode,
  addPage,
  deleteNodes,
  deletePage,
  frameAtPoint,
  renamePage,
  updateNode,
} from './ops';

function setup() {
  const doc = createDocument('Test');
  const pageId = doc.pages[0]!.id;
  return { doc, pageId };
}

describe('addNode', () => {
  it('adds a top-level node to the page in render order', () => {
    const { doc, pageId } = setup();
    const a = createRectangle({ pageId });
    const b = createRectangle({ pageId });
    addNode(doc, a);
    addNode(doc, b);
    expect(doc.pages[0]!.childIds).toEqual([a.id, b.id]);
    expect(doc.nodes[a.id]).toBe(a);
  });

  it('nests a node inside a frame', () => {
    const { doc, pageId } = setup();
    const frame = createFrame({ pageId });
    addNode(doc, frame);
    const rect = createRectangle({ pageId, parentId: frame.id });
    addNode(doc, rect);
    expect(frame.childIds).toEqual([rect.id]);
    expect(doc.pages[0]!.childIds).toEqual([frame.id]);
  });

  it('rejects a parent that cannot hold children', () => {
    const { doc, pageId } = setup();
    const rect = createRectangle({ pageId });
    addNode(doc, rect);
    expect(() => addNode(doc, createRectangle({ pageId, parentId: rect.id }))).toThrow(DocumentError);
  });

  it('rejects duplicate ids', () => {
    const { doc, pageId } = setup();
    const rect = createRectangle({ pageId });
    addNode(doc, rect);
    expect(() => addNode(doc, rect)).toThrow(/Duplicate/);
  });
});

describe('updateNode', () => {
  it('updates editable properties', () => {
    const { doc, pageId } = setup();
    const rect = createRectangle({ pageId });
    addNode(doc, rect);
    updateNode(doc, rect.id, { x: 40, width: 250, name: 'Card' });
    expect(doc.nodes[rect.id]).toMatchObject({ x: 40, width: 250, name: 'Card' });
  });

  it('refuses structural fields and invalid values', () => {
    const { doc, pageId } = setup();
    const rect = createRectangle({ pageId });
    addNode(doc, rect);
    expect(() => updateNode(doc, rect.id, { parentId: 'x' } as never)).toThrow(/parentId/);
    expect(() => updateNode(doc, rect.id, { width: -1 })).toThrow(/Width/);
    expect(() => updateNode(doc, rect.id, { opacity: 2 })).toThrow(/Opacity/);
    expect(() => updateNode(doc, 'missing', { x: 1 })).toThrow(/not found/);
  });
});

describe('deleteNodes', () => {
  it('removes descendants and detaches from the page', () => {
    const { doc, pageId } = setup();
    const frame = createFrame({ pageId });
    addNode(doc, frame);
    const child = createRectangle({ pageId, parentId: frame.id });
    addNode(doc, child);
    const other = createRectangle({ pageId });
    addNode(doc, other);

    deleteNodes(doc, [frame.id]);

    expect(doc.nodes[frame.id]).toBeUndefined();
    expect(doc.nodes[child.id]).toBeUndefined();
    expect(doc.pages[0]!.childIds).toEqual([other.id]);
  });

  it('handles a parent and child selected together', () => {
    const { doc, pageId } = setup();
    const frame = createFrame({ pageId });
    addNode(doc, frame);
    const child = createRectangle({ pageId, parentId: frame.id });
    addNode(doc, child);
    deleteNodes(doc, [child.id, frame.id]);
    expect(Object.keys(doc.nodes)).toHaveLength(0);
    expect(doc.pages[0]!.childIds).toEqual([]);
  });
});

describe('pages', () => {
  it('adds pages with unique default names', () => {
    const { doc } = setup();
    expect(addPage(doc).name).toBe('Page 2');
    expect(addPage(doc).name).toBe('Page 3');
  });

  it('renames with validation', () => {
    const { doc, pageId } = setup();
    renamePage(doc, pageId, '  Home  ');
    expect(doc.pages[0]!.name).toBe('Home');
    expect(() => renamePage(doc, pageId, '   ')).toThrow(/empty/);
  });

  it('deletes a page and its nodes but never the last page', () => {
    const { doc, pageId } = setup();
    expect(() => deletePage(doc, pageId)).toThrow(/at least one page/);
    const page2 = addPage(doc);
    const rect = createRectangle({ pageId: page2.id });
    addNode(doc, rect);
    deletePage(doc, page2.id);
    expect(doc.pages).toHaveLength(1);
    expect(doc.nodes[rect.id]).toBeUndefined();
  });
});

describe('geometry helpers', () => {
  it('computes absolute positions through parents', () => {
    const { doc, pageId } = setup();
    const frame = createFrame({ pageId, x: 100, y: 50 });
    addNode(doc, frame);
    const rect = createRectangle({ pageId, parentId: frame.id, x: 10, y: 20 });
    addNode(doc, rect);
    expect(absolutePosition(doc, rect.id)).toEqual({ x: 110, y: 70 });
  });

  it('finds the deepest frame under a point', () => {
    const { doc, pageId } = setup();
    const outer = createFrame({ pageId, x: 0, y: 0, width: 400, height: 400 });
    addNode(doc, outer);
    const inner = createFrame({ pageId, parentId: outer.id, x: 50, y: 50, width: 100, height: 100 });
    addNode(doc, inner);
    expect(frameAtPoint(doc, pageId, 75, 75)).toBe(inner.id);
    expect(frameAtPoint(doc, pageId, 300, 300)).toBe(outer.id);
    expect(frameAtPoint(doc, pageId, 500, 500)).toBeNull();
  });
});
