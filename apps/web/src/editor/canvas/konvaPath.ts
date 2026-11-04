import { applyMatrix, type Matrix, type PathCommand, type PathSink } from '@canvas-studio/core';

/**
 * Traces a path with every point pre-multiplied by `m`. Used for clip functions, where
 * changing the context transform would also transform the clipped content.
 */
export function traceTransformed(ctx: PathSink & { beginPath(): void }, cmds: readonly PathCommand[], m: Matrix) {
  const p = (x: number, y: number) => applyMatrix(m, { x, y });
  ctx.beginPath();
  for (const c of cmds) {
    if (c.c === 'M') {
      const a = p(c.x, c.y);
      ctx.moveTo(a.x, a.y);
    } else if (c.c === 'L') {
      const a = p(c.x, c.y);
      ctx.lineTo(a.x, a.y);
    } else if (c.c === 'C') {
      const a = p(c.x1, c.y1);
      const b = p(c.x2, c.y2);
      const e = p(c.x, c.y);
      ctx.bezierCurveTo(a.x, a.y, b.x, b.y, e.x, e.y);
    } else {
      ctx.closePath();
    }
  }
}
