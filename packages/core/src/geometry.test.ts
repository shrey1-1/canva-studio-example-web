import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  decompose,
  invert,
  multiply,
  nodeOutline,
  pathBounds,
  polygonPoints,
  rectPath,
  starPoints,
  toSvgPath,
  transformMatrix,
  vectorPath,
} from './geometry';
import { computeSnap } from './snapping';
import { createLine, createStar, vertex } from './factory';

describe('matrices', () => {
  it('inverts and decomposes rotation + translation', () => {
    const m = transformMatrix(10, 20, 30);
    const back = multiply(invert(m), m);
    expect(back.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(decompose(m)).toEqual({ x: 10, y: 20, rotation: 30 });
    expect(decompose(transformMatrix(0, 0, -90)).rotation).toBe(270);
  });

  it('maps points', () => {
    const p = applyMatrix(transformMatrix(100, 0, 90), { x: 10, y: 0 });
    expect({ x: Math.round(p.x), y: Math.round(p.y) }).toEqual({ x: 100, y: 10 });
  });
});

describe('outlines', () => {
  it('rectangles without radius are four lines', () => {
    expect(toSvgPath(rectPath(10, 20))).toBe('M0 0 L10 0 L10 20 L0 20 Z');
  });

  it('clamps corner radius to half the shortest side', () => {
    const b = pathBounds(rectPath(10, 40, 100));
    expect(b).toEqual({ x: 0, y: 0, width: 10, height: 40 });
  });

  it('polygons and stars fill their box', () => {
    const tri = polygonPoints(100, 100, 3);
    expect(Math.min(...tri.map((p) => p.y))).toBe(0);
    expect(Math.max(...tri.map((p) => p.y))).toBeCloseTo(100);
    expect(Math.max(...tri.map((p) => p.x))).toBeCloseTo(100);
    const star = starPoints(100, 50, 5, 0.4);
    expect(star).toHaveLength(10);
    expect(Math.max(...star.map((p) => p.y))).toBeCloseTo(50);
    expect(nodeOutline(createStar({ pageId: 'p' })).at(-1)).toEqual({ c: 'Z' });
  });

  it('lines are open two-point paths', () => {
    const line = createLine({ pageId: 'p', width: 80 });
    expect(toSvgPath(nodeOutline(line))).toBe('M0 0 L80 0');
    expect(line.height).toBe(0);
  });

  it('computes exact bounds of curves, not of control points', () => {
    // A symmetric arch: control points reach y=-40 but the curve only reaches y=-30.
    const cmds = vectorPath([vertex(0, 0, { outY: -40 }), vertex(100, 0, { inY: -40 })], false);
    const b = pathBounds(cmds);
    expect(b.y).toBeCloseTo(-30);
    expect(b.width).toBe(100);
  });
});

describe('computeSnap', () => {
  const target = { x: 100, y: 100, width: 100, height: 50 };

  it('snaps the nearest edge within the threshold and reports guides', () => {
    const r = computeSnap({ x: 203, y: 300, width: 40, height: 40 }, [target], 5);
    expect(r.dx).toBe(-3); // left edge -> target right edge (200)
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', position: 200, start: 100, end: 340 }]);
  });

  it('snaps centres', () => {
    // Moving centre y = 122, target centre y = 125; edges are all further than 5 away.
    const r = computeSnap({ x: 0, y: 112, width: 20, height: 20 }, [target], 5);
    expect(r.dy).toBe(3);
    expect(r.guides).toEqual([{ axis: 'y', position: 125, start: 0, end: 200 }]);
  });

  it('does nothing beyond the threshold', () => {
    const r = computeSnap({ x: 500, y: 500, width: 10, height: 10 }, [target], 5);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});
