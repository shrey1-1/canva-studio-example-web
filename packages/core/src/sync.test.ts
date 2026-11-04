import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createDocument, createFrame, createImage, createRectangle, createText, solid } from './factory';
import { addNode, deleteNodes, updateNode } from './ops';
import { applyDocChange, approximateTextMeasure, diffDocuments } from './sync';
import { safePatch } from './tools/patch';
import { exportSvg } from './export/svg';
import { buildPdf } from './export/pdf';
import { documentProblem } from './validate';
import type { TextNode } from './model';

function base() {
  const doc = createDocument('Sync');
  const pageId = doc.pages[0]!.id;
  const frame = createFrame({ pageId, name: 'Card', x: 10, y: 20, width: 200, height: 100 });
  addNode(doc, frame);
  const rect = createRectangle({ pageId, parentId: frame.id, x: 5, y: 5, width: 50, height: 30 });
  addNode(doc, rect);
  return { doc, frame: frame.id, rect: rect.id, pageId };
}

describe('document sync', () => {
  it('diffs only changed nodes and replays them onto another copy', () => {
    const { doc, rect } = base();
    const edited = produce(doc, (d) => updateNode(d, rect, { x: 40 }));
    const change = diffDocuments(doc, edited)!;
    expect(Object.keys(change.nodes!)).toEqual([rect]);
    expect(change.pages).toBeUndefined();
    expect(applyDocChange(doc, change).nodes[rect]!.x).toBe(40);
    expect(diffDocuments(edited, edited)).toBeNull();
  });

  it('carries deletions and structure, and merges edits to different layers', () => {
    const { doc, frame, rect } = base();
    const a = produce(doc, (d) => updateNode(d, frame, { name: 'Renamed' }));
    const b = produce(doc, (d) => deleteNodes(d, [rect]));
    const merged = applyDocChange(applyDocChange(doc, diffDocuments(doc, a)!), diffDocuments(doc, b)!);
    expect(merged.nodes[rect]).toBeUndefined();
    // Last writer wins per node: b's frame (child removed) replaces a's rename.
    expect(documentProblem(merged)).toBeNull();
  });

  it('measures text without a browser', () => {
    const t = createText({ pageId: 'p', characters: 'Hello\nWorld!', fontSize: 10 }) as TextNode;
    expect(approximateTextMeasure(t, null)).toEqual({ width: Math.ceil(6 * 5.5), height: Math.ceil(2 * 10 * t.lineHeight) });
  });
});

describe('safe patches', () => {
  it('drops protected keys and rejects invalid layers', () => {
    const { doc, rect } = base();
    const node = doc.nodes[rect]!;
    expect(safePatch(node, { x: 1, parentId: 'evil', bindings: {}, nope: 1 })).toEqual({ x: 1 });
    expect(() => safePatch(node, { fills: 'red' })).toThrow(/Invalid update/);
  });
});

describe('SVG export', () => {
  it('exports frames, clipping, fills and text, with escaping', () => {
    const { doc, frame, pageId } = base();
    doc.nodes[frame]!.fills = [solid('#FF0000')];
    const t = createText({ pageId, parentId: frame, x: 0, y: 50, characters: 'A < B & "C"' });
    addNode(doc, t);
    const svg = exportSvg(doc, [frame])!;
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="200" height="100" viewBox="10 20 200 100">/);
    expect(svg).toContain('fill="#FF0000"');
    expect(svg).toContain('clip-path="url(#clip');
    expect(svg).toContain('A &lt; B &amp; &quot;C&quot;');
    expect(svg).not.toContain('<script');
    expect(exportSvg(doc, [])).toBeNull();
  });

  it('embeds images only through the resolver', () => {
    const { doc, pageId } = base();
    const img = createImage({ pageId, assetId: 'abc', naturalWidth: 20, naturalHeight: 10, width: 20, height: 10 });
    addNode(doc, img);
    expect(exportSvg(doc, [img.id], { imageHref: () => 'data:image/png;base64,AAAA' })).toContain('href="data:image/png;base64,AAAA"');
    expect(exportSvg(doc, [img.id])).not.toContain('<image');
  });
});

describe('PDF export', () => {
  it('writes a valid multi-page PDF with correct cross-reference offsets', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = buildPdf([{ width: 200, height: 100, jpeg, pixelWidth: 2, pixelHeight: 1 }, { width: 50, height: 50, jpeg, pixelWidth: 1, pixelHeight: 1 }], 'My (deck)');
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 2');
    expect(text).toContain('/MediaBox [0 0 200 100]');
    expect(text).toContain('/Title (My \\(deck\\))');
    // Every xref entry points at the start of its object.
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    const entries = text.slice(xrefAt).split('\n').filter((l) => / 00000 n $/.test(l));
    entries.forEach((line, i) => expect(text.slice(Number(line.slice(0, 10)), Number(line.slice(0, 10)) + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`)));
    expect(entries).toHaveLength(2 * 3 + 3);
  });
});
