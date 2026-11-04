import { describe, expect, it } from 'vitest';
import { addNode } from '../ops';
import { createDocument, createRectangle, createText } from '../factory';
import { addCollection, addMode, addVariable, setVariableValue } from '../variables';
import { createPixels, pixelStretch, renderAirbrush, renderClouds, renderFractalNoise, renderNebula, seededRandom } from './generators';
import { bentoGrid, STICKERS } from './layouts';
import { signedArea, simplifyLoop, traceImage, traceMask, tracedToSvg } from './trace';
import { collectTokens, formatTokens } from './tokens';

const base = { width: 32, height: 24, seed: 7 };

describe('generators', () => {
  it('are deterministic per seed and fill every pixel', () => {
    const a = renderFractalNoise({ ...base, scale: 8, octaves: 4, amplitude: 0.5, frequency: 2, colorA: '#000000', colorB: '#FFFFFF' });
    const b = renderFractalNoise({ ...base, scale: 8, octaves: 4, amplitude: 0.5, frequency: 2, colorA: '#000000', colorB: '#FFFFFF' });
    expect(a.data).toEqual(b.data);
    expect(a.data.length).toBe(32 * 24 * 4);
    const values = new Set<number>();
    for (let i = 0; i < a.data.length; i += 4) values.add(a.data[i]!);
    expect(values.size).toBeGreaterThan(10); // real noise, not a flat colour
  });

  it('nebula, clouds and airbrush produce opaque / alpha output as expected', () => {
    const n = renderNebula({ ...base, colorA: '#7C3AED', colorB: '#EC4899', background: '#05010F', density: 0.6, stars: 20 });
    expect(n.data[3]).toBe(255);
    const c = renderClouds({ ...base, sky: '#60A5FA', cloud: '#FFFFFF', density: 0.5, scale: 20, opacity: 1 });
    expect(c.data[3]).toBe(255);
    const air = renderAirbrush({ ...base, color: '#FF0000', background: null, size: 10, grain: 0.5, opacity: 1, strokes: 3 });
    let transparent = 0;
    for (let i = 3; i < air.data.length; i += 4) if (air.data[i] === 0) transparent++;
    expect(transparent).toBeGreaterThan(0);
  });

  it('caps generated size', () => {
    expect(createPixels(100_000, 10).width).toBe(4096);
  });

  it('pixel stretch repeats the source column', () => {
    const src = createPixels(4, 1);
    src.data.set([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 40, 0, 0, 255]);
    const out = pixelStretch(src, { direction: 'horizontal', position: 1 / 3, length: 1, side: 'after' });
    expect([out.data[0], out.data[4], out.data[8], out.data[12]]).toEqual([10, 20, 20, 20]);
    expect(src.data[8]).toBe(30); // input untouched
  });

  it('seeded random is stable', () => {
    const r = seededRandom(42);
    expect([r(), r()]).toEqual([seededRandom(42)(), (() => { const q = seededRandom(42); q(); return q(); })()]);
  });
});

describe('image to vector', () => {
  it('traces a filled square as one clockwise loop and drops holes', () => {
    const mask = new Uint8Array([1, 1, 1, 1, 0, 1, 1, 1, 1]);
    const loops = traceMask(mask, 3, 3);
    const areas = loops.map(signedArea).sort((a, b) => a - b);
    expect(areas).toEqual([-1, 9]); // the hole runs the other way
  });

  it('traces a two-colour image into regions, largest first', () => {
    const img = createPixels(10, 10);
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) {
        const inner = x >= 3 && x < 7 && y >= 3 && y < 7;
        img.data.set(inner ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 10 + x) * 4);
      }
    const paths = traceImage(img, { colors: 2, detail: 0.5, minArea: 1 });
    expect(paths).toHaveLength(2);
    expect(paths[0]!.area).toBe(100);
    expect(paths[1]!.color).toBe('#FF0000');
    expect(tracedToSvg(paths, 10, 10)).toContain('fill="#FF0000"');
  });

  it('simplification keeps corners and removes noise', () => {
    const loop = [{ x: 0, y: 0 }, { x: 5, y: 0.1 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(simplifyLoop(loop, 1)).toHaveLength(4);
  });
});

describe('layouts', () => {
  it('bento grid covers the area without overlaps', () => {
    const cards = bentoGrid({ width: 400, height: 300, columns: 4, rows: 3, gap: 10, variety: 0.6, seed: 3 });
    const area = cards.reduce((s, c) => s + c.width * c.height, 0);
    expect(cards.length).toBeLessThan(12);
    expect(area).toBeLessThanOrEqual(400 * 300);
    for (const a of cards)
      for (const b of cards) {
        if (a === b) continue;
        const overlap = a.x < b.x + b.width - 0.01 && b.x < a.x + a.width - 0.01 && a.y < b.y + b.height - 0.01 && b.y < a.y + a.height - 0.01;
        expect(overlap).toBe(false);
      }
  });

  it('stickers are closed polygons in a 100px box', () => {
    for (const s of Object.values(STICKERS)) {
      expect(s.points.length).toBeGreaterThanOrEqual(3);
      expect(s.points.every(([x, y]) => x >= -1 && x <= 101 && y >= -1 && y <= 101)).toBe(true);
    }
  });
});

describe('token export', () => {
  it('collects variables and used values into every format', () => {
    const doc = createDocument();
    const pageId = doc.pages[0]!.id;
    const col = addCollection(doc, 'Brand');
    const dark = addMode(doc, col.id, 'Dark');
    const v = addVariable(doc, col.id, 'color', 'Primary');
    setVariableValue(doc, v.id, dark, '#000000');
    const r = createRectangle({ pageId });
    r.cornerRadius = 8;
    r.effects = [{ type: 'drop-shadow', color: '#000000', x: 0, y: 4, blur: 12, opacity: 0.25, visible: true }];
    addNode(doc, r);
    addNode(doc, createText({ pageId, characters: 'Hi', fontSize: 24 }));
    const t = collectTokens(doc);
    expect(t.color['brand-primary-mode-1']).toBe('#3B82F6');
    expect(t.color['brand-primary-dark']).toBe('#000000');
    expect(t.radius['radius-8']).toBe(8);
    expect(t.shadow['shadow-1']).toBe('0px 4px 12px rgba(0, 0, 0, 0.25)');
    expect(Object.keys(t.typography)).toEqual(['arial-24-400']);
    expect(formatTokens(t, 'css')).toContain('--radius-8: 8px;');
    expect(formatTokens(t, 'scss')).toContain('$radius-8: 8px;');
    expect(JSON.parse(formatTokens(t, 'json')).radius['radius-8']).toBe(8);
    expect(formatTokens(t, 'js')).toMatch(/^export const tokens = /);
  });
});

describe('nodeFromSpec (untrusted tool output)', () => {
  it('builds valid nodes and rejects bad input', async () => {
    const { nodeFromSpec } = await import('./spec');
    const r = nodeFromSpec({ type: 'rectangle', x: 5, y: 6, width: 10, height: 20, fill: '#ff0000', cornerRadius: 4 }, 'p', null);
    expect(r).toMatchObject({ type: 'rectangle', x: 5, width: 10, cornerRadius: 4 });
    expect(r.fills[0]!.color).toBe('#FF0000');
    const v = nodeFromSpec({ type: 'vector', x: 100, y: 100, points: [[10, 10], [30, 10], [20, 40]] }, 'p', null);
    expect({ x: v.x, y: v.y, w: v.width, h: v.height }).toEqual({ x: 110, y: 110, w: 20, h: 30 });
    expect(() => nodeFromSpec({ type: 'script' }, 'p', null)).toThrow(/Unsupported/);
    expect(() => nodeFromSpec({ type: 'rectangle', width: 1e12 }, 'p', null)).toThrow(/width/);
    expect(() => nodeFromSpec({ type: 'rectangle', fill: 'red' }, 'p', null)).toThrow(/fill/);
    expect(() => nodeFromSpec({ type: 'vector', points: [[0, 0], ['x', 1]] }, 'p', null)).toThrow(/pairs/);
  });
});
