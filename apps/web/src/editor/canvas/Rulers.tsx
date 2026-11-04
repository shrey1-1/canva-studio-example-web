import { memo, useEffect, useRef } from 'react';
import { rulerTicks, type Viewport } from '@canvas-studio/core';

export const RULER_SIZE = 20;

/** Top and left rulers showing page coordinates; redrawn on pan/zoom/resize. */
export const Rulers = memo(function Rulers({ viewport, width, height }: { viewport: Viewport; width: number; height: number }) {
  return (
    <>
      <RulerCanvas orientation="horizontal" viewport={viewport} length={width} />
      <RulerCanvas orientation="vertical" viewport={viewport} length={height} />
    </>
  );
});

function RulerCanvas({ orientation, viewport, length }: { orientation: 'horizontal' | 'vertical'; viewport: Viewport; length: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const horizontal = orientation === 'horizontal';

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || length <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = horizontal ? length : RULER_SIZE;
    const h = horizontal ? RULER_SIZE : length;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#252525';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#383838';
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(w, h - 0.5);
    } else {
      ctx.moveTo(w - 0.5, 0);
      ctx.lineTo(w - 0.5, h);
    }
    ctx.stroke();

    const offset = horizontal ? viewport.x : viewport.y;
    ctx.fillStyle = '#71717A';
    ctx.strokeStyle = '#52525B';
    ctx.font = '10px Inter, system-ui, sans-serif';
    ctx.beginPath();
    for (const value of rulerTicks(offset, viewport.zoom, length, 60)) {
      const pos = Math.round(value * viewport.zoom + offset) + 0.5;
      if (pos < RULER_SIZE) continue;
      if (horizontal) {
        ctx.moveTo(pos, h - 6);
        ctx.lineTo(pos, h);
        ctx.fillText(String(value), pos + 3, 11);
      } else {
        ctx.moveTo(w - 6, pos);
        ctx.lineTo(w, pos);
        ctx.save();
        ctx.translate(11, pos - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(value), 0, 0);
        ctx.restore();
      }
    }
    ctx.stroke();
  }, [horizontal, viewport, length]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute top-0 left-0"
      style={horizontal ? { width: length, height: RULER_SIZE } : { width: RULER_SIZE, height: length }}
    />
  );
}
