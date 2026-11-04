import Konva from 'konva';
import type { TextMeasure, TextNode } from '@canvas-studio/core';

const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/** CSS font-family value; names with spaces are quoted. */
export function cssFontFamily(name: string): string {
  if (GENERIC_FAMILIES.has(name)) return name;
  return `"${name.replace(/"/g, '')}", sans-serif`;
}

/** Konva `fontStyle` string ("italic 700"). */
export function konvaFontStyle(node: Pick<TextNode, 'italic' | 'fontWeight'>): string {
  return `${node.italic ? 'italic ' : ''}${node.fontWeight}`;
}

/** Props shared by the renderer and the measurer, so measurement matches what is drawn. */
export function konvaTextProps(node: TextNode) {
  return {
    text: node.characters,
    fontFamily: cssFontFamily(node.fontFamily),
    fontSize: node.fontSize,
    fontStyle: konvaFontStyle(node),
    lineHeight: node.lineHeight,
    letterSpacing: node.letterSpacing,
    align: node.textAlign,
    textDecoration: node.textDecoration === 'none' ? '' : node.textDecoration,
    padding: 0,
  };
}

let canvasAvailable: boolean | null = null;
function hasCanvas(): boolean {
  if (canvasAvailable === null) {
    // jsdom (unit tests) has no 2D canvas; fall back to an estimate there.
    canvasAvailable = !navigator.userAgent.includes('jsdom') && !!document.createElement('canvas').getContext('2d');
  }
  return canvasAvailable;
}

const cache = new Map<string, { width: number; height: number }>();
const CACHE_LIMIT = 1000;
let probe: Konva.Text | null = null;

/** Measures text exactly as Konva will lay it out. */
export const measureText: TextMeasure = (node, width) => {
  const props = konvaTextProps(node);
  // An empty box still has the height of one line.
  const text = props.text === '' ? ' ' : props.text;
  const key = JSON.stringify([text, props.fontFamily, props.fontSize, props.fontStyle, props.lineHeight, props.letterSpacing, width]);
  const hit = cache.get(key);
  if (hit) return hit;

  let size: { width: number; height: number };
  if (!hasCanvas()) {
    const lines = text.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    size = { width: width ?? longest * node.fontSize * 0.55, height: lines.length * node.fontSize * node.lineHeight };
  } else {
    probe ??= new Konva.Text();
    probe.setAttrs({ ...props, text, wrap: width === null ? 'none' : 'word', width: width ?? undefined });
    if (width === null) probe.width(undefined as unknown as number); // auto width
    size = { width: probe.width(), height: probe.height() };
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, size);
  return size;
};
