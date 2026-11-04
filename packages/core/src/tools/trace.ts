/**
 * Image to Vector: reduce an image to a few colours (k-means), trace each colour region's
 * outline (marching squares), simplify it (Ramer-Douglas-Peucker) and return filled paths.
 *
 * Holes are not cut out. Instead every outline is returned largest-first: anything inside a hole
 * is a smaller region of another colour, so it is drawn later, on top, and the result looks right.
 */
import type { Point } from '../viewport';
import { seededRandom, type Pixels } from './generators';

export interface TraceParams {
  /** Number of colours, 2..12 */
  colors: number;
  /** Simplification tolerance in source pixels (higher = fewer points). */
  detail: number;
  /** Regions smaller than this many pixels are dropped. */
  minArea: number;
}

export interface TracedPath {
  color: string;
  points: Point[];
  area: number;
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

/** Clusters opaque pixels into `k` colours. Returns the label per pixel (-1 = transparent). */
export function quantize(src: Pixels, k: number, seed = 1): { labels: Int16Array; palette: [number, number, number][] } {
  const n = src.width * src.height;
  const labels = new Int16Array(n).fill(-1);
  const opaque: number[] = [];
  for (let i = 0; i < n; i++) if (src.data[i * 4 + 3]! >= 128) opaque.push(i);
  if (opaque.length === 0) return { labels, palette: [] };
  const rand = seededRandom(seed);
  const count = Math.max(1, Math.min(k, opaque.length));
  const palette: [number, number, number][] = [];
  for (let c = 0; c < count; c++) {
    const i = opaque[Math.floor(rand() * opaque.length)]! * 4;
    palette.push([src.data[i]!, src.data[i + 1]!, src.data[i + 2]!]);
  }
  for (let iter = 0; iter < 10; iter++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const p of opaque) {
      const o = p * 4;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < palette.length; c++) {
        const [r, g, b] = palette[c]!;
        const d = (src.data[o]! - r) ** 2 + (src.data[o + 1]! - g) ** 2 + (src.data[o + 2]! - b) ** 2;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      labels[p] = best;
      const s = sums[best]!;
      s[0]! += src.data[o]!;
      s[1]! += src.data[o + 1]!;
      s[2]! += src.data[o + 2]!;
      s[3]!++;
    }
    sums.forEach((s, c) => {
      if (s[3]) palette[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    });
  }
  return { labels, palette };
}

/**
 * Outlines of the `true` regions of a mask, as closed loops on pixel-corner coordinates.
 * Outer outlines run clockwise (positive area in screen coordinates); holes run the other way.
 */
export function traceMask(mask: Uint8Array, width: number, height: number): Point[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < width && y < height ? mask[y * width + x]! : 0);
  // Edge segments between pixel corners, oriented with the filled side on the right.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (width + 1) + x;
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = next.get(k);
    if (list) list.push(key(x1, y1));
    else next.set(k, [key(x1, y1)]);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops: Point[][] = [];
  const W = width + 1;
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const loop: Point[] = [];
      let cur = start;
      do {
        loop.push({ x: cur % W, y: Math.floor(cur / W) });
        const outs = next.get(cur)!;
        const to = outs.pop()!;
        if (outs.length === 0) next.delete(cur);
        cur = to;
      } while (cur !== start && next.has(cur) && loop.length < 1_000_000);
      if (loop.length >= 3) loops.push(removeCollinear(loop));
    }
  }
  return loops;
}

function removeCollinear(points: Point[]): Point[] {
  return points.filter((p, i) => {
    const a = points[(i - 1 + points.length) % points.length]!;
    const b = points[(i + 1) % points.length]!;
    return (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
  });
}

export function signedArea(points: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Ramer-Douglas-Peucker simplification of a closed loop. */
export function simplifyLoop(points: readonly Point[], tolerance: number): Point[] {
  if (points.length <= 4 || tolerance <= 0) return [...points];
  const rdp = (pts: readonly Point[]): Point[] => {
    if (pts.length < 3) return [...pts];
    const a = pts[0]!;
    const b = pts[pts.length - 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let maxD = 0;
    let idx = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD <= tolerance) return [a, b];
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))];
  };
  // Split the loop at its farthest point from the start so both halves are open polylines.
  let far = 0;
  let farD = -1;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
    if (d > farD) {
      farD = d;
      far = i;
    }
  });
  const first = rdp(points.slice(0, far + 1));
  const second = rdp([...points.slice(far), points[0]!]);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  return out.length >= 3 ? out : [...points];
}

/** Traces an image into filled colour regions, largest first. Coordinates are in source pixels. */
export function traceImage(src: Pixels, params: TraceParams): TracedPath[] {
  const k = Math.max(2, Math.min(12, Math.round(params.colors)));
  const { labels, palette } = quantize(src, k);
  const paths: TracedPath[] = [];
  const mask = new Uint8Array(src.width * src.height);
  palette.forEach((rgb, c) => {
    for (let i = 0; i < mask.length; i++) mask[i] = labels[i] === c ? 1 : 0;
    for (const loop of traceMask(mask, src.width, src.height)) {
      const area = signedArea(loop);
      if (area <= 0 || area < params.minArea) continue; // holes and specks
      paths.push({ color: toHex(...rgb), points: simplifyLoop(loop, Math.max(0, params.detail)), area });
    }
  });
  return paths.sort((a, b) => b.area - a.area);
}

/** Paths as an SVG document (for "export as SVG"). */
export function tracedToSvg(paths: readonly TracedPath[], width: number, height: number): string {
  const body = paths
    .map((p) => `<path fill="${p.color}" d="M${p.points.map((q) => `${q.x} ${q.y}`).join(' L')} Z"/>`)
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  ${body}\n</svg>\n`;
}
