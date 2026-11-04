/**
 * Viewport math. `screen = world * zoom + offset`, where offset = (x, y).
 */
export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 256;

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export function screenToWorld(vp: Viewport, p: Point): Point {
  return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

export function worldToScreen(vp: Viewport, p: Point): Point {
  return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

/** Zooms so that the world point under `screenPoint` stays under it. */
export function zoomAt(vp: Viewport, nextZoom: number, screenPoint: Point): Viewport {
  const zoom = clampZoom(nextZoom);
  const world = screenToWorld(vp, screenPoint);
  return { zoom, x: screenPoint.x - world.x * zoom, y: screenPoint.y - world.y * zoom };
}

/** Viewport that fits `bounds` inside a `size` area with padding, never zooming above `maxZoom`. */
export function fitBounds(
  bounds: Rect,
  size: { width: number; height: number },
  padding = 64,
  maxZoom = 1,
): Viewport {
  if (bounds.width <= 0 || bounds.height <= 0 || size.width <= 0 || size.height <= 0) {
    return { x: size.width / 2, y: size.height / 2, zoom: 1 };
  }
  const availW = Math.max(1, size.width - padding * 2);
  const availH = Math.max(1, size.height - padding * 2);
  const zoom = clampZoom(Math.min(availW / bounds.width, availH / bounds.height, maxZoom));
  return {
    zoom,
    x: (size.width - bounds.width * zoom) / 2 - bounds.x * zoom,
    y: (size.height - bounds.height * zoom) / 2 - bounds.y * zoom,
  };
}

/** Union of rectangles, or null when empty. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** World-unit step between ruler/grid lines so that lines are at least `minScreenGap` px apart. */
export function niceStep(zoom: number, minScreenGap = 50): number {
  const raw = minScreenGap / zoom;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= raw) return m * pow;
  }
  return 10 * pow;
}

/** World positions of ruler ticks visible along an axis of `length` screen pixels. */
export function rulerTicks(offset: number, zoom: number, length: number, minScreenGap = 50): number[] {
  const step = niceStep(zoom, minScreenGap);
  const start = Math.floor(-offset / zoom / step) * step;
  const end = (length - offset) / zoom;
  const ticks: number[] = [];
  for (let v = start; v <= end; v += step) {
    // `+ 0` turns -0 into 0 so labels never read "-0".
    ticks.push(Math.round(v * 1e6) / 1e6 + 0);
  }
  return ticks;
}
