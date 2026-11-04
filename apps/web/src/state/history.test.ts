import { describe, expect, it } from 'vitest';
import { addNode, createDocument, createRectangle, updateNode } from '@canvas-studio/core';
import { COALESCE_WINDOW_MS, commit, redo, undo, type HistoryState } from './history';

const empty = (): HistoryState => ({ past: [], future: [] });

function setup() {
  const doc = createDocument();
  const pageId = doc.pages[0]!.id;
  const rect = createRectangle({ pageId });
  return { doc, pageId, rect };
}

describe('history', () => {
  it('records a change and undoes/redoes it', () => {
    const { doc, rect } = setup();
    const a = commit(doc, empty(), 'Add', (d) => addNode(d, rect));
    expect(a.doc.nodes[rect.id]).toBeDefined();
    expect(a.history.past).toHaveLength(1);

    const u = undo(a.doc, a.history)!;
    expect(u.doc.nodes[rect.id]).toBeUndefined();
    expect(u.history.future).toHaveLength(1);

    const r = redo(u.doc, u.history)!;
    expect(r.doc.nodes[rect.id]).toBeDefined();
  });

  it('ignores recipes that change nothing', () => {
    const { doc } = setup();
    const result = commit(doc, empty(), 'Noop', () => {});
    expect(result.doc).toBe(doc);
    expect(result.history.past).toHaveLength(0);
  });

  it('does not record an undo step when an update sets the same value (regression)', () => {
    const { doc, rect } = setup();
    const a = commit(doc, empty(), 'Add', (d) => addNode(d, rect));
    const b = commit(a.doc, a.history, 'Width', (d) => updateNode(d, rect.id, { width: rect.width }));
    expect(b.history.past).toHaveLength(1);
    expect(b.doc).toBe(a.doc);
  });

  it('coalesces rapid changes with the same key into one undo step', () => {
    const { doc, rect } = setup();
    let s = commit(doc, empty(), 'Add', (d) => addNode(d, rect), { now: 0 });
    s = commit(s.doc, s.history, 'X', (d) => updateNode(d, rect.id, { x: 1 }), { coalesceKey: 'x', now: 100 });
    s = commit(s.doc, s.history, 'X', (d) => updateNode(d, rect.id, { x: 2 }), { coalesceKey: 'x', now: 200 });
    s = commit(s.doc, s.history, 'X', (d) => updateNode(d, rect.id, { x: 3 }), { coalesceKey: 'x', now: 300 });
    expect(s.history.past).toHaveLength(2);

    const u = undo(s.doc, s.history)!;
    expect(u.doc.nodes[rect.id]!.x).toBe(0);
  });

  it('starts a new step after the coalesce window', () => {
    const { doc, rect } = setup();
    let s = commit(doc, empty(), 'Add', (d) => addNode(d, rect), { now: 0 });
    s = commit(s.doc, s.history, 'X', (d) => updateNode(d, rect.id, { x: 1 }), { coalesceKey: 'x', now: 100 });
    s = commit(s.doc, s.history, 'X', (d) => updateNode(d, rect.id, { x: 2 }), { coalesceKey: 'x', now: 100 + COALESCE_WINDOW_MS + 1 });
    expect(s.history.past).toHaveLength(3);
  });

  it('clears redo history after a new change', () => {
    const { doc, rect } = setup();
    const a = commit(doc, empty(), 'Add', (d) => addNode(d, rect));
    const u = undo(a.doc, a.history)!;
    const b = commit(u.doc, u.history, 'Add again', (d) => addNode(d, createRectangle({ pageId: d.pages[0]!.id })));
    expect(b.history.future).toHaveLength(0);
  });

  it('returns null when there is nothing to undo or redo', () => {
    const { doc } = setup();
    expect(undo(doc, empty())).toBeNull();
    expect(redo(doc, empty())).toBeNull();
  });
});
