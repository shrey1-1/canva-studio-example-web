/**
 * Design token export: collects colours, typography, spacing, radii and shadows from a document
 * (variables first, then values used on layers) and serialises them as JSON, CSS, SCSS or JS.
 */
import type { DesignDocument } from '../model';
import { isFrameLike } from '../model';

export type TokenFormat = 'json' | 'css' | 'scss' | 'js';

export interface TokenSet {
  color: Record<string, string>;
  typography: Record<string, { fontFamily: string; fontSize: number; fontWeight: number; lineHeight: number; letterSpacing: number }>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  shadow: Record<string, string>;
  number: Record<string, number>;
  string: Record<string, string>;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'token';

const unique = (base: string, taken: Record<string, unknown>) => {
  let name = base;
  for (let i = 2; name in taken; i++) name = `${base}-${i}`;
  return name;
};

const rgba = (hex: string, opacity: number) => {
  const n = parseInt(hex.slice(1), 16);
  return opacity >= 1 ? hex : `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(opacity * 100) / 100})`;
};

export function collectTokens(doc: DesignDocument): TokenSet {
  const t: TokenSet = { color: {}, typography: {}, spacing: {}, radius: {}, shadow: {}, number: {}, string: {} };
  // Variables (one token per mode when a collection has several modes).
  for (const v of doc.variables) {
    const col = doc.variableCollections.find((c) => c.id === v.collectionId);
    if (!col) continue;
    for (const mode of col.modes) {
      const value = v.valuesByMode[mode.id];
      if (value === undefined) continue;
      const name = slug(col.modes.length > 1 ? `${col.name} ${v.name} ${mode.name}` : `${col.name} ${v.name}`);
      if (v.type === 'color') t.color[unique(name, t.color)] = String(value);
      else if (v.type === 'number') t.number[unique(name, t.number)] = Number(value);
      else if (v.type === 'string') t.string[unique(name, t.string)] = String(value);
    }
  }
  // Values used on layers.
  const colors = new Set(Object.values(t.color));
  const typeKeys = new Set<string>();
  const spacing = new Set<number>();
  const radii = new Set<number>();
  const shadows = new Set<string>();
  for (const n of Object.values(doc.nodes)) {
    for (const f of n.fills) {
      if (f.visible && !colors.has(f.color)) {
        colors.add(f.color);
        t.color[unique(`color-${Object.keys(t.color).length + 1}`, t.color)] = f.color;
      }
    }
    if (n.type === 'text') {
      const key = `${n.fontFamily}|${n.fontSize}|${n.fontWeight}|${n.lineHeight}|${n.letterSpacing}`;
      if (!typeKeys.has(key)) {
        typeKeys.add(key);
        t.typography[unique(slug(`${n.fontFamily} ${n.fontSize} ${n.fontWeight}`), t.typography)] = {
          fontFamily: n.fontFamily,
          fontSize: n.fontSize,
          fontWeight: n.fontWeight,
          lineHeight: n.lineHeight,
          letterSpacing: n.letterSpacing,
        };
      }
    }
    if (isFrameLike(n) && n.layout) {
      for (const v of [n.layout.gap, n.layout.paddingTop, n.layout.paddingRight, n.layout.paddingBottom, n.layout.paddingLeft]) if (v > 0) spacing.add(v);
    }
    if ('cornerRadius' in n && n.cornerRadius > 0) radii.add(n.cornerRadius);
    for (const e of n.effects) {
      if (e.type === 'drop-shadow' && e.visible) shadows.add(`${e.x}px ${e.y}px ${e.blur}px ${rgba(e.color, e.opacity)}`);
    }
  }
  [...spacing].sort((a, b) => a - b).forEach((v) => (t.spacing[`space-${v}`] = v));
  [...radii].sort((a, b) => a - b).forEach((v) => (t.radius[`radius-${v}`] = v));
  [...shadows].forEach((v, i) => (t.shadow[`shadow-${i + 1}`] = v));
  return t;
}

function flat(t: TokenSet): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(t.color)) out.push([`color-${k}`.replace(/^color-color-/, 'color-'), v]);
  for (const [k, v] of Object.entries(t.typography)) {
    out.push([`font-${k}-family`, `"${v.fontFamily}"`], [`font-${k}-size`, `${v.fontSize}px`], [`font-${k}-weight`, String(v.fontWeight)], [`font-${k}-line-height`, String(v.lineHeight)]);
    if (v.letterSpacing) out.push([`font-${k}-letter-spacing`, `${v.letterSpacing}px`]);
  }
  for (const [k, v] of Object.entries(t.spacing)) out.push([k, `${v}px`]);
  for (const [k, v] of Object.entries(t.radius)) out.push([k, `${v}px`]);
  for (const [k, v] of Object.entries(t.shadow)) out.push([k, v]);
  for (const [k, v] of Object.entries(t.number)) out.push([k, String(v)]);
  for (const [k, v] of Object.entries(t.string)) out.push([k, JSON.stringify(v)]);
  return out;
}

export function formatTokens(tokens: TokenSet, format: TokenFormat): string {
  switch (format) {
    case 'json':
      return `${JSON.stringify(tokens, null, 2)}\n`;
    case 'js':
      return `export const tokens = ${JSON.stringify(tokens, null, 2)};\n`;
    case 'css':
      return `:root {\n${flat(tokens).map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}\n`;
    case 'scss':
      return `${flat(tokens).map(([k, v]) => `$${k}: ${v};`).join('\n')}\n`;
  }
}

export const TOKEN_FILE_EXT: Record<TokenFormat, string> = { json: 'json', css: 'css', scss: 'scss', js: 'js' };
