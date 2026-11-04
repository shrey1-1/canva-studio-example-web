import { describe, expect, it } from 'vitest';
import { copyNodes, duplicateNodes, parseClipboard, pasteNodes } from './clipboard';
import { createDocument, createFrame, createRectangle } from './factory';
import { worldMatrix } from './geometry';
import { addNode } from './ops';
import { isValidDocument } from './validate';

function setup() {
  const doc = createDocument('Test');
  const pageId = doc.pages[0]!.id;
  const frame = createFrame({ pageId, x: 100, y: 100, width: 300, height: 300, name: 'Card' });
  const child = createRectangle({ pageId, parentId: frame.id, x: 10, y: 10, name: 'Inner' });
  addNode(doc, frame);
  addNode(doc, child);
  return { doc, pageId, frame, child };
}

describe('copy / paste', () => {
  it('round-trips a subtree through JSON with fresh ids', () => {
    const { doc, pageId, frame } = setup();
    const payload = copyNodes(doc, [frame.id])!;
    const parsed = parseClipboard(JSON.stringify(payload))!;
    expect(parsed).not.toBeNull();
    const [newId] = pasteNodes(doc, parsed, { pageId, parentId: null, offset: { x: 10, y: 10 } });
    const copy = doc.nodes[newId!]!;
    expect(newId).not.toBe(frame.id);
    expect(copy.name).toBe('Card');
    expect({ x: copy.x, y: copy.y }).toEqual({ x: 110, y: 110 });
    expect(copy.type === 'frame' && copy.childIds.length).toBe(1);
    const childCopy = copy.type === 'frame' ? doc.nodes[copy.childIds[0]!]! : null;
    expect(childCopy?.parentId).toBe(newId);
    expect(isValidDocument(doc)).toBe(true);
  });

  it('keeps page-space position when pasted into another parent', () => {
    const { doc, pageId, child } = setup();
    const payload = copyNodes(doc, [child.id])!;
    const [id] = pasteNodes(doc, payload, { pageId, parentId: null });
    const m = worldMatrix(doc, id!);
    expect({ x: m[4], y: m[5] }).toEqual({ x: 110, y: 110 });
  });

  it('rejects malformed or hostile clipboard text', () => {
    expect(parseClipboard('not json')).toBeNull();
    expect(parseClipboard('{"kind":"other"}')).toBeNull();
    const { doc, frame } = setup();
    const payload = copyNodes(doc, [frame.id])!;
    const broken = structuredClone(payload);
    const root = broken.nodes[frame.id]!;
    if (root.type === 'frame') root.childIds.push('ghost');
    expect(parseClipboard(JSON.stringify(broken))).toBeNull();
    const cyclic = structuredClone(payload);
    const r2 = cyclic.nodes[frame.id]!;
    if (r2.type === 'frame') r2.childIds.push(frame.id);
    expect(parseClipboard(JSON.stringify(cyclic))).toBeNull();
    const huge = structuredClone(payload);
    huge.nodes[frame.id]!.width = 1e12;
    expect(parseClipboard(JSON.stringify(huge))).toBeNull();
  });

  it('duplicates in place, directly above the original', () => {
    const { doc, frame, child } = setup();
    const [dup] = duplicateNodes(doc, [child.id], { x: 0, y: 0 });
    expect(frame.childIds).toEqual([child.id, dup]);
    expect(doc.nodes[dup!]!.x).toBe(10);
  });
});

describe('clipboard hardening (review fixes)', () => {
  it('strips unknown keys and rejects unbounded blur', () => {
    const { doc, frame } = setup();
    const payload = copyNodes(doc, [frame.id])!;
    const extra = structuredClone(payload) as unknown as { nodes: Record<string, Record<string, unknown>> };
    extra.nodes[frame.id]!.__proto_payload = 'x';
    const parsed = parseClipboard(JSON.stringify(extra))!;
    expect(parsed.nodes[frame.id]).not.toHaveProperty('__proto_payload');

    const blurred = structuredClone(payload);
    blurred.nodes[frame.id]!.effects = [{ type: 'layer-blur', radius: 1e6, visible: true }];
    expect(parseClipboard(JSON.stringify(blurred))).toBeNull();
  });
});
