import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, fitBounds, niceStep, rulerTicks, screenToWorld, unionRects, worldToScreen, zoomAt } from './viewport';

describe('viewport math', () => {
  const vp = { x: 100, y: 50, zoom: 2 };

  it('converts screen <-> world', () => {
    const world = screenToWorld(vp, { x: 300, y: 250 });
    expect(world).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(vp, world)).toEqual({ x: 300, y: 250 });
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const cursor = { x: 400, y: 300 };
    const before = screenToWorld(vp, cursor);
    const next = zoomAt(vp, 5, cursor);
    const after = screenToWorld(next, cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(next.zoom).toBe(5);
  });

  it('clamps zoom', () => {
    expect(zoomAt(vp, 1e9, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(vp, 0, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
  });

  it('fits bounds centred inside an area without exceeding max zoom', () => {
    const fit = fitBounds({ x: 0, y: 0, width: 100, height: 100 }, { width: 1000, height: 600 }, 50, 1);
    expect(fit.zoom).toBe(1);
    expect(fit.x).toBe(450);
    expect(fit.y).toBe(250);
    const big = fitBounds({ x: 0, y: 0, width: 2000, height: 1000 }, { width: 1100, height: 600 }, 50, 1);
    expect(big.zoom).toBeCloseTo(0.5);
  });

  it('unions rectangles', () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 5, height: 5 },
      ]),
    ).toEqual({ x: 0, y: -5, width: 25, height: 15 });
  });
});

describe('ruler ticks', () => {
  it('chooses 1-2-5 steps at least the minimum gap apart', () => {
    expect(niceStep(1, 50)).toBe(50);
    expect(niceStep(2, 50)).toBe(50);
    expect(niceStep(0.1, 50)).toBe(500);
    expect(niceStep(10, 50)).toBe(5);
  });

  it('covers the visible range', () => {
    const ticks = rulerTicks(0, 1, 200, 50);
    expect(ticks).toEqual([0, 50, 100, 150, 200]);
    const panned = rulerTicks(125, 1, 200, 50);
    expect(panned[0]).toBe(-150);
    expect(panned.at(-1)).toBe(50);
  });
});
