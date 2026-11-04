import type { Paint, Stroke } from '@canvas-studio/core';

/** `#RRGGBB` + opacity -> `rgba()` string Konva understands. */
export function toRgba(hex: string, opacity = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(0,0,0,${opacity})`;
  const n = parseInt(m[1]!, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/** Konva renders one fill per shape; the top-most visible paint wins (multi-fill comes later). */
export function topFill(fills: readonly Paint[]): string | undefined {
  for (let i = fills.length - 1; i >= 0; i--) {
    const p = fills[i]!;
    if (p.visible) return toRgba(p.color, p.opacity);
  }
  return undefined;
}

export function topStroke(strokes: readonly Stroke[]): { stroke?: string; strokeWidth?: number } {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i]!;
    if (s.visible && s.width > 0) return { stroke: toRgba(s.color, s.opacity), strokeWidth: s.width };
  }
  return {};
}
