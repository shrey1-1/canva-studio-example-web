/**
 * Procedural image generators used by the built-in effect tools. Pure functions over RGBA
 * pixel buffers (no DOM), seeded so the same settings always produce the same image.
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8ClampedArray;
}

export const MAX_GENERATED_SIDE = 4096;

export function createPixels(width: number, height: number): Pixels {
  const w = Math.max(1, Math.min(MAX_GENERATED_SIDE, Math.round(width)));
  const h = Math.max(1, Math.min(MAX_GENERATED_SIDE, Math.round(height)));
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

/** Small, fast seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D value noise with smooth interpolation, in [0, 1]. */
export function valueNoise(seed: number): (x: number, y: number) => number {
  const rand = seededRandom(seed);
  const SIZE = 256;
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const at = (ix: number, iy: number) => table[((iy & (SIZE - 1)) * SIZE) + (ix & (SIZE - 1))]!;
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = at(ix, iy);
    const b = at(ix + 1, iy);
    const c = at(ix, iy + 1);
    const d = at(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal Brownian motion: several octaves of noise, normalised to [0, 1]. */
export function fbm(noise: (x: number, y: number) => number, x: number, y: number, octaves: number, gain = 0.5, lacunarity = 2): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function put(p: Pixels, i: number, r: number, g: number, b: number, a = 255) {
  p.data[i] = r;
  p.data[i + 1] = g;
  p.data[i + 2] = b;
  p.data[i + 3] = a;
}

export interface FractalNoiseParams {
  width: number;
  height: number;
  /** Feature size in pixels. */
  scale: number;
  octaves: number;
  /** 0..1, how much each octave contributes relative to the previous one. */
  amplitude: number;
  /** Frequency multiplier between octaves. */
  frequency: number;
  colorA: string;
  colorB: string;
  seed: number;
}

export function renderFractalNoise(p: FractalNoiseParams): Pixels {
  const out = createPixels(p.width, p.height);
  const noise = valueNoise(p.seed);
  const a = hexToRgb(p.colorA);
  const b = hexToRgb(p.colorB);
  const scale = Math.max(1, p.scale);
  const octaves = Math.max(1, Math.min(10, Math.round(p.octaves)));
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const v = fbm(noise, x / scale, y / scale, octaves, clamp01(p.amplitude), Math.max(1, p.frequency));
      const i = (y * out.width + x) * 4;
      put(out, i, mix(a[0], b[0], v), mix(a[1], b[1], v), mix(a[2], b[2], v));
    }
  }
  return out;
}

export interface NebulaParams {
  width: number;
  height: number;
  /** Nebula colours, blended by noise. */
  colorA: string;
  colorB: string;
  background: string;
  /** 0..1 */
  density: number;
  /** Stars per 10,000 pixels. */
  stars: number;
  seed: number;
}

export function renderNebula(p: NebulaParams): Pixels {
  const out = createPixels(p.width, p.height);
  const n1 = valueNoise(p.seed);
  const n2 = valueNoise(p.seed + 101);
  const a = hexToRgb(p.colorA);
  const b = hexToRgb(p.colorB);
  const bg = hexToRgb(p.background);
  const scale = Math.max(out.width, out.height) / 4;
  const density = clamp01(p.density);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      // Domain warp makes the clouds swirl.
      const wx = fbm(n2, x / scale, y / scale, 3) * 2;
      const cloud = fbm(n1, x / scale + wx, y / scale + wx, 6);
      const glow = clamp01((cloud - (1 - density) * 0.6) * 2.2);
      const hue = fbm(n2, x / scale + 5, y / scale + 5, 4);
      const r = mix(bg[0], mix(a[0], b[0], hue), glow);
      const g = mix(bg[1], mix(a[1], b[1], hue), glow);
      const bl = mix(bg[2], mix(a[2], b[2], hue), glow);
      put(out, (y * out.width + x) * 4, r, g, bl);
    }
  }
  const rand = seededRandom(p.seed + 7);
  const count = Math.round((out.width * out.height * Math.max(0, p.stars)) / 10_000);
  for (let s = 0; s < count; s++) {
    const x = Math.floor(rand() * out.width);
    const y = Math.floor(rand() * out.height);
    const bright = 150 + rand() * 105;
    const big = rand() > 0.97;
    for (let dy = big ? -1 : 0; dy <= (big ? 1 : 0); dy++) {
      for (let dx = big ? -1 : 0; dx <= (big ? 1 : 0); dx++) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= out.width || py >= out.height) continue;
        const k = dx === 0 && dy === 0 ? 1 : 0.4;
        const i = (py * out.width + px) * 4;
        put(out, i, Math.max(out.data[i]!, bright * k), Math.max(out.data[i + 1]!, bright * k), Math.max(out.data[i + 2]!, bright * k));
      }
    }
  }
  return out;
}

export interface CloudsParams {
  width: number;
  height: number;
  sky: string;
  cloud: string;
  /** 0..1, how much of the sky is covered. */
  density: number;
  /** Feature size in pixels: larger = bigger, softer clouds. */
  scale: number;
  /** 0..1 */
  opacity: number;
  seed: number;
}

export function renderClouds(p: CloudsParams): Pixels {
  const out = createPixels(p.width, p.height);
  const noise = valueNoise(p.seed);
  const sky = hexToRgb(p.sky);
  const cloud = hexToRgb(p.cloud);
  const scale = Math.max(4, p.scale);
  const threshold = 1 - clamp01(p.density);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const v = fbm(noise, x / scale, y / (scale * 0.6), 6);
      const c = clamp01((v - threshold * 0.8) / 0.35) * clamp01(p.opacity);
      // Slightly darker undersides give the clouds volume.
      const shade = 1 - 0.15 * clamp01(fbm(noise, x / scale + 3, (y + scale * 0.1) / (scale * 0.6), 4) - v + 0.5);
      put(out, (y * out.width + x) * 4, mix(sky[0], cloud[0] * shade, c), mix(sky[1], cloud[1] * shade, c), mix(sky[2], cloud[2] * shade, c));
    }
  }
  return out;
}

export interface AirbrushParams {
  width: number;
  height: number;
  color: string;
  /** Transparent background when empty, otherwise a colour. */
  background: string | null;
  /** Brush diameter in pixels. */
  size: number;
  /** 0..1 */
  grain: number;
  /** 0..1 */
  opacity: number;
  /** Number of strokes. */
  strokes: number;
  seed: number;
}

/** Soft, grainy airbrush strokes along random smooth curves. */
export function renderAirbrush(p: AirbrushParams): Pixels {
  const out = createPixels(p.width, p.height);
  const rand = seededRandom(p.seed);
  const col = hexToRgb(p.color);
  const bg = p.background ? hexToRgb(p.background) : null;
  const alpha = new Float32Array(out.width * out.height);
  const radius = Math.max(2, p.size / 2);
  const strokes = Math.max(1, Math.min(50, Math.round(p.strokes)));
  for (let s = 0; s < strokes; s++) {
    // A cubic curve across the canvas.
    const pts = Array.from({ length: 4 }, () => [rand() * out.width, rand() * out.height] as const);
    const steps = 80;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const cx = u * u * u * pts[0]![0] + 3 * u * u * t * pts[1]![0] + 3 * u * t * t * pts[2]![0] + t * t * t * pts[3]![0];
      const cy = u * u * u * pts[0]![1] + 3 * u * u * t * pts[1]![1] + 3 * u * t * t * pts[2]![1] + t * t * t * pts[3]![1];
      const x0 = Math.max(0, Math.floor(cx - radius));
      const x1 = Math.min(out.width - 1, Math.ceil(cx + radius));
      const y0 = Math.max(0, Math.floor(cy - radius));
      const y1 = Math.min(out.height - 1, Math.ceil(cy + radius));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy) / radius;
          if (d >= 1) continue;
          const falloff = (1 - d) * (1 - d) * 0.08;
          const i = y * out.width + x;
          alpha[i] = Math.min(1, alpha[i]! + falloff);
        }
      }
    }
  }
  const grain = clamp01(p.grain);
  const op = clamp01(p.opacity);
  for (let i = 0; i < alpha.length; i++) {
    const noise = 1 - grain + grain * rand() * 2;
    const a = clamp01(alpha[i]! * noise) * op;
    const o = i * 4;
    if (bg) put(out, o, mix(bg[0], col[0], a), mix(bg[1], col[1], a), mix(bg[2], col[2], a));
    else put(out, o, col[0], col[1], col[2], a * 255);
  }
  return out;
}

export interface PixelStretchParams {
  direction: 'horizontal' | 'vertical';
  /** 0..1 position of the source row/column. */
  position: number;
  /** 0..1 how far the smear extends from the source line. */
  length: number;
  /** Which way the smear goes from the line. */
  side: 'after' | 'before' | 'both';
}

/** Repeats one row (or column) of pixels across part of the image. Returns a new buffer. */
export function pixelStretch(src: Pixels, p: PixelStretchParams): Pixels {
  const out: Pixels = { width: src.width, height: src.height, data: new Uint8ClampedArray(src.data) };
  const horiz = p.direction === 'horizontal';
  // "horizontal" smears a column sideways; "vertical" smears a row downwards/upwards.
  const span = horiz ? src.width : src.height;
  const line = Math.max(0, Math.min(span - 1, Math.round(clamp01(p.position) * (span - 1))));
  const len = Math.round(clamp01(p.length) * span);
  const from = p.side === 'after' ? line : Math.max(0, line - len);
  const to = p.side === 'before' ? line : Math.min(span - 1, line + len);
  const other = horiz ? src.height : src.width;
  for (let k = from; k <= to; k++) {
    for (let j = 0; j < other; j++) {
      const s = horiz ? (j * src.width + line) * 4 : (line * src.width + j) * 4;
      const d = horiz ? (j * src.width + k) * 4 : (k * src.width + j) * 4;
      out.data[d] = src.data[s]!;
      out.data[d + 1] = src.data[s + 1]!;
      out.data[d + 2] = src.data[s + 2]!;
      out.data[d + 3] = src.data[s + 3]!;
    }
  }
  return out;
}
