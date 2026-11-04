import { beforeEach, describe, expect, it } from 'vitest';
import {
  addNode,
  createDocument,
  createFrame,
  createRectangle,
  createText,
  isValidDocument,
  type DesignDocument,
  type GroupNode,
} from '@canvas-studio/core';
import { useEditor } from '../state/editorStore';
import * as cmd from './commands';
import { resolveClickTarget, resolveDoubleClickTarget, isArtboardBackground } from './canvas/selectionRules';

let doc: DesignDocument;
let pageId: string;

function load(...nodes: Parameters<typeof addNode>[1][]) {
  for (const n of nodes) addNode(doc, n);
  useEditor.getState().loadDocument(doc);
  useEditor.getState().setCanvasSize({ width: 1000, height: 800 });
}

const ed = () => useEditor.getState();
const page = () => ed().doc.pages[0]!;

beforeEach(() => {
  doc = createDocument('Commands');
  pageId = doc.pages[0]!.id;
});

describe('clipboard commands', () => {
  it('copy + paste creates offset copies above the original and selects them', () => {
    const r = createRectangle({ pageId, x: 0, y: 0, name: 'Box' });
    load(r);
    ed().select([r.id]);
    const json = cmd.copySelection();
    expect(json).toContain('canvas-studio/nodes');
    cmd.pastePayload(JSON.parse(json!));
    const [orig, copy] = page().childIds;
    expect(orig).toBe(r.id);
    expect(ed().selection).toEqual([copy]);
    expect(ed().doc.nodes[copy!]).toMatchObject({ name: 'Box', x: 10, y: 10 });
    // A second paste of the same payload steps further.
    cmd.pastePayload(JSON.parse(json!));
    expect(ed().doc.nodes[ed().selection[0]!]).toMatchObject({ x: 20, y: 20 });
  });

  it('cut removes the layer and paste brings it back in place (one undo step each)', () => {
    const r = createRectangle({ pageId, x: 30, y: 40 });
    load(r);
    ed().select([r.id]);
    const json = cmd.cutSelection()!;
    expect(ed().doc.nodes[r.id]).toBeUndefined();
    cmd.pastePayload(JSON.parse(json));
    const pasted = ed().doc.nodes[ed().selection[0]!]!;
    expect({ x: pasted.x, y: pasted.y }).toEqual({ x: 30, y: 40 });
    ed().undo();
    expect(page().childIds).toEqual([]);
  });

  it('pastes into a selected frame, keeping the layer visible inside it', () => {
    const frame = createFrame({ pageId, x: 1000, y: 1000, width: 200, height: 200 });
    const r = createRectangle({ pageId, x: 0, y: 0, width: 20, height: 20 });
    load(frame, r);
    ed().select([r.id]);
    const payload = JSON.parse(cmd.copySelection()!);
    ed().select([frame.id]);
    cmd.pastePayload(payload);
    const pasted = ed().doc.nodes[ed().selection[0]!]!;
    expect(pasted.parentId).toBe(frame.id);
    // Moved into the frame's area because its copied position was outside it.
    expect(pasted.x).toBeGreaterThanOrEqual(0);
    expect(pasted.x + pasted.width).toBeLessThanOrEqual(200);
  });

  it('pasting plain text creates a text layer', async () => {
    load();
    await cmd.pasteFromSystem('Hello world', []);
    const node = ed().doc.nodes[ed().selection[0]!]!;
    expect(node.type).toBe('text');
    expect(node.type === 'text' && node.characters).toBe('Hello world');
    expect(node.width).toBeGreaterThan(0); // auto-sized by the finalize step
  });

  it('duplicate offsets the copy and keeps the document valid', () => {
    const r = createRectangle({ pageId, x: 5, y: 5 });
    load(r);
    ed().select([r.id]);
    cmd.duplicateSelection();
    expect(page().childIds).toHaveLength(2);
    expect(ed().doc.nodes[ed().selection[0]!]).toMatchObject({ x: 15, y: 15 });
    expect(isValidDocument(ed().doc)).toBe(true);
  });
});

describe('structure commands', () => {
  it('group / ungroup round-trips and the group tracks child moves', () => {
    const a = createRectangle({ pageId, x: 0, y: 0, width: 10, height: 10 });
    const b = createRectangle({ pageId, x: 40, y: 0, width: 10, height: 10 });
    load(a, b);
    ed().select([a.id, b.id]);
    cmd.groupSelection();
    const gid = ed().selection[0]!;
    expect(ed().doc.nodes[gid]!.type).toBe('group');
    expect(ed().doc.nodes[gid]!.width).toBe(50);

    // Moving a child through dispatch refits the group in the same undo step.
    ed().dispatch('Move', (d) => {
      d.nodes[b.id]!.x = 90;
    });
    expect(ed().doc.nodes[gid]!.width).toBe(100);
    ed().undo();
    expect(ed().doc.nodes[gid]!.width).toBe(50);

    ed().select([gid]);
    cmd.ungroupSelection();
    expect(ed().doc.nodes[gid]).toBeUndefined();
    expect(ed().selection).toEqual([a.id, b.id]);
  });

  it('deleting the last child of a group removes the group', () => {
    const a = createRectangle({ pageId });
    load(a);
    ed().select([a.id]);
    cmd.groupSelection();
    const gid = ed().selection[0]!;
    ed().select([a.id]);
    cmd.deleteSelection();
    expect(ed().doc.nodes[gid]).toBeUndefined();
    expect(page().childIds).toEqual([]);
  });

  it('use as mask on several layers groups them with the bottom one as mask', () => {
    const shape = createRectangle({ pageId, name: 'Shape' });
    const img = createRectangle({ pageId, name: 'Content' });
    load(shape, img);
    ed().select([img.id, shape.id]);
    cmd.useAsMask();
    const g = ed().doc.nodes[ed().selection[0]!] as GroupNode;
    expect(g.name).toBe('Mask group');
    expect(g.childIds).toEqual([shape.id, img.id]);
    expect(ed().doc.nodes[shape.id]!.isMask).toBe(true);
  });

  it('reorder, lock and hide act on the selection', () => {
    const a = createRectangle({ pageId });
    const b = createRectangle({ pageId });
    load(a, b);
    ed().select([a.id]);
    cmd.reorderSelection('front');
    expect(page().childIds).toEqual([b.id, a.id]);
    cmd.toggleVisibility();
    expect(ed().doc.nodes[a.id]!.visible).toBe(false);
    cmd.toggleLock();
    expect(ed().doc.nodes[a.id]!.locked).toBe(true);
    // Locked layers are not deleted.
    cmd.deleteSelection();
    expect(ed().doc.nodes[a.id]).toBeDefined();
  });

  it('text layers grow to fit their characters', () => {
    const t = createText({ pageId, characters: 'Hi' });
    load(t);
    const before = ed().doc.nodes[t.id]!.width;
    ed().dispatch('Edit', (d) => {
      const n = d.nodes[t.id]!;
      if (n.type === 'text') n.characters = 'Hello, much longer text';
    });
    expect(ed().doc.nodes[t.id]!.width).toBeGreaterThan(before);
  });
});

describe('selection rules', () => {
  it('a click inside a group selects the group; a double-click enters it', () => {
    const a = createRectangle({ pageId });
    const b = createRectangle({ pageId, x: 50 });
    load(a, b);
    ed().select([a.id, b.id]);
    cmd.groupSelection();
    const gid = ed().selection[0]!;
    const d = ed().doc;
    expect(resolveClickTarget(d, a.id, [])).toBe(gid);
    expect(resolveDoubleClickTarget(d, a.id, [gid])).toBe(a.id);
    // Once inside, single clicks reach siblings.
    expect(resolveClickTarget(d, b.id, [a.id])).toBe(b.id);
  });

  it('top-level frames with content act as artboards', () => {
    const frame = createFrame({ pageId });
    const child = createRectangle({ pageId, parentId: frame.id });
    const empty = createFrame({ pageId });
    load(frame, child, empty);
    const d = ed().doc;
    expect(isArtboardBackground(d, frame.id, [])).toBe(true);
    expect(isArtboardBackground(d, frame.id, [frame.id])).toBe(false);
    expect(isArtboardBackground(d, empty.id, [])).toBe(false);
  });
});
