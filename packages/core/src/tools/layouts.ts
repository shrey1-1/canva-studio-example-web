/** Layout generators and template data for the built-in layout/mockup/sticker tools. */
import type { Rect } from '../viewport';
import { seededRandom } from './generators';

export interface BentoParams {
  width: number;
  height: number;
  columns: number;
  rows: number;
  gap: number;
  /** 0..1: chance that a card grows to span two columns and/or rows. */
  variety: number;
  seed: number;
}

/**
 * Packs cards into a grid where some cards span 2 columns and/or 2 rows.
 * Every cell is covered exactly once.
 */
export function bentoGrid(p: BentoParams): Rect[] {
  const cols = Math.max(1, Math.min(12, Math.round(p.columns)));
  const rows = Math.max(1, Math.min(12, Math.round(p.rows)));
  const gap = Math.max(0, p.gap);
  const cellW = (p.width - gap * (cols - 1)) / cols;
  const cellH = (p.height - gap * (rows - 1)) / rows;
  const used = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const rand = seededRandom(p.seed);
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (used[r]![c]) continue;
      let w = 1;
      let h = 1;
      if (rand() < p.variety && c + 1 < cols && !used[r]![c + 1]) w = 2;
      if (rand() < p.variety * 0.7 && r + 1 < rows && !used[r + 1]![c] && (w === 1 || !used[r + 1]![c + 1])) h = 2;
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) used[r + dr]![c + dc] = true;
      out.push({
        x: c * (cellW + gap),
        y: r * (cellH + gap),
        width: cellW * w + gap * (w - 1),
        height: cellH * h + gap * (h - 1),
      });
    }
  }
  return out;
}

export interface DeviceSpec {
  id: string;
  name: string;
  /** Screen size in points. */
  screenWidth: number;
  screenHeight: number;
  /** Outer corner radius of the body. */
  radius: number;
  /** Body border around the screen. */
  bezel: number;
  /** Camera cut-out style. */
  camera: 'island' | 'punch-hole' | 'none';
  /** Older phones have bezels with a home button. */
  homeButton: boolean;
}

export const DEVICES: readonly DeviceSpec[] = [
  { id: 'iphone-16', name: 'iPhone 16', screenWidth: 393, screenHeight: 852, radius: 62, bezel: 12, camera: 'island', homeButton: false },
  { id: 'iphone-16-pro-max', name: 'iPhone 16 Pro Max', screenWidth: 440, screenHeight: 956, radius: 66, bezel: 12, camera: 'island', homeButton: false },
  { id: 'pixel-9', name: 'Pixel 9', screenWidth: 412, screenHeight: 915, radius: 52, bezel: 12, camera: 'punch-hole', homeButton: false },
  { id: 'iphone-se', name: 'iPhone SE', screenWidth: 375, screenHeight: 667, radius: 56, bezel: 20, camera: 'none', homeButton: true },
];

export type MockupTemplate = 'browser' | 'laptop' | 'tablet' | 'poster';

export const MOCKUP_TEMPLATES: readonly { id: MockupTemplate; name: string; screenWidth: number; screenHeight: number }[] = [
  { id: 'browser', name: 'Browser window', screenWidth: 1280, screenHeight: 800 },
  { id: 'laptop', name: 'Laptop', screenWidth: 1280, screenHeight: 800 },
  { id: 'tablet', name: 'Tablet', screenWidth: 834, screenHeight: 1194 },
  { id: 'poster', name: 'Framed poster', screenWidth: 600, screenHeight: 800 },
];

/** Sticker outlines in a 100x100 box (closed polygons; curves are pre-sampled). */
export const STICKERS: Record<string, { name: string; points: [number, number][]; color: string }> = (() => {
  const star = (n: number, inner: number): [number, number][] =>
    Array.from({ length: n * 2 }, (_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / n;
      const r = i % 2 === 0 ? 50 : 50 * inner;
      return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
    });
  const heart: [number, number][] = Array.from({ length: 48 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    return [50 + x * 2.9, 45 - y * 2.9];
  });
  const blob: [number, number][] = Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    const r = 42 + 6 * Math.sin(a * 3) + 3 * Math.cos(a * 5);
    return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
  });
  return {
    star: { name: 'Star', points: star(5, 0.45), color: '#FACC15' },
    burst: { name: 'Burst', points: star(12, 0.72), color: '#F97316' },
    sparkle: { name: 'Sparkle', points: star(4, 0.25), color: '#A855F7' },
    heart: { name: 'Heart', points: heart, color: '#EF4444' },
    bolt: { name: 'Lightning', points: [[58, 0], [18, 58], [46, 58], [36, 100], [82, 38], [54, 38], [70, 0]], color: '#EAB308' },
    bubble: { name: 'Speech bubble', points: [[10, 10], [90, 10], [90, 70], [45, 70], [22, 92], [28, 70], [10, 70]], color: '#3B82F6' },
    arrow: { name: 'Arrow', points: [[0, 38], [60, 38], [60, 15], [100, 50], [60, 85], [60, 62], [0, 62]], color: '#22C55E' },
    blob: { name: 'Blob', points: blob, color: '#EC4899' },
  };
})();
