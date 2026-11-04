/**
 * Smart guides: snaps a moving rectangle's edges/centre to other rectangles' edges/centres
 * and reports the guide lines to draw. Pure math, in page space.
 */
import type { Rect } from './viewport';

export interface Guide {
  /** 'x' = vertical line at `position`; 'y' = horizontal line. */
  axis: 'x' | 'y';
  position: number;
  /** Extent of the line along the other axis. */
  start: number;
  end: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

const xs = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width];
const ys = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height];

function bestOffset(moving: number[], targets: number[][], threshold: number): number | null {
  let best: number | null = null;
  for (const m of moving) {
    for (const list of targets) {
      for (const t of list) {
        const d = t - m;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }
  return best;
}

/**
 * @param moving    bounds of the dragged selection at its unsnapped position
 * @param targets   bounds of the layers it can snap to
 * @param threshold snap distance in page units (use screen pixels / zoom)
 */
export function computeSnap(moving: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  const dx = bestOffset(xs(moving), targets.map(xs), threshold);
  const dy = bestOffset(ys(moving), targets.map(ys), threshold);
  const snapped: Rect = { ...moving, x: moving.x + (dx ?? 0), y: moving.y + (dy ?? 0) };
  const guides: Guide[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  if (dx !== null) {
    for (const x of new Set(xs(snapped))) {
      const hits = targets.filter((t) => xs(t).some((tx) => near(tx, x)));
      if (hits.length === 0) continue;
      const all = [snapped, ...hits];
      guides.push({ axis: 'x', position: x, start: Math.min(...all.map((r) => r.y)), end: Math.max(...all.map((r) => r.y + r.height)) });
    }
  }
  if (dy !== null) {
    for (const y of new Set(ys(snapped))) {
      const hits = targets.filter((t) => ys(t).some((ty) => near(ty, y)));
      if (hits.length === 0) continue;
      const all = [snapped, ...hits];
      guides.push({ axis: 'y', position: y, start: Math.min(...all.map((r) => r.x)), end: Math.max(...all.map((r) => r.x + r.width)) });
    }
  }
  return { dx: dx ?? 0, dy: dy ?? 0, guides };
}
