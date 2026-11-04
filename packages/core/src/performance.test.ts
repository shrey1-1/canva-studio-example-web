import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createDocument, createFrame, createRectangle, createText } from './factory';
import { finalizeDocument } from './finalize';
import { addNode, updateNode } from './ops';
import { diffDocuments } from './sync';
import { documentProblem } from './validate';
import { exportSvg } from './export/svg';
import { approximateTextMeasure } from './sync';

/** A large file: 100 frames with 50 layers each (5,100 layers). */
function bigDocument() {
  const doc = createDocument('Large');
  const pageId = doc.pages[0]!.id;
  for (let f = 0; f < 100; f++) {
    const frame = createFrame({ pageId, name: `Screen ${f}`, x: (f % 10) * 500, y: Math.floor(f / 10) * 900, width: 400, height: 800 });
    addNode(doc, frame);
    for (let i = 0; i < 50; i++) {
      const pos = { pageId, parentId: frame.id, x: (i % 5) * 70, y: Math.floor(i / 5) * 70, width: 60, height: 60 };
      addNode(doc, i % 10 === 0 ? createText({ ...pos, characters: `Label ${i}` }) : createRectangle(pos));
    }
  }
  return doc;
}

const time = (fn: () => void) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

// Budgets are generous (slow CI machines); they catch accidental O(n²) work, not small regressions.
describe('large documents', () => {
  const doc = bigDocument();

  it('validates, finalizes and diffs 5,000+ layers quickly', () => {
    expect(Object.keys(doc.nodes)).toHaveLength(5100);
    expect(time(() => expect(documentProblem(doc)).toBeNull())).toBeLessThan(1000);
    let finalized = doc;
    expect(time(() => (finalized = produce(doc, (d) => finalizeDocument(d, approximateTextMeasure))))).toBeLessThan(3000);
    const anyRect = Object.values(finalized.nodes).find((n) => n.type === 'rectangle')!;
    let edited = finalized;
    const editMs = time(() => (edited = produce(finalized, (d) => {
      updateNode(d, anyRect.id, { x: 5 });
      finalizeDocument(d, approximateTextMeasure);
    })));
    expect(editMs).toBeLessThan(1500);
    let change: ReturnType<typeof diffDocuments> = null;
    expect(time(() => (change = diffDocuments(finalized, edited)))).toBeLessThan(100);
    expect(Object.keys(change!.nodes!)).toEqual([anyRect.id]);
  });

  it('exports a full screen to SVG quickly', () => {
    const frame = doc.pages[0]!.childIds[0]!;
    let svg: string | null = null;
    expect(time(() => (svg = exportSvg(doc, [frame])))).toBeLessThan(500);
    expect(svg!.length).toBeGreaterThan(1000);
  });
});
