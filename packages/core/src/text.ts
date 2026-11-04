/**
 * Text layout rules. Measuring needs a real font engine, so callers inject `measure`
 * (the web app uses the canvas; a server could use a font library).
 */
import type { DesignDocument, TextNode } from './model';
import { round } from './geometry';

/** Fonts available on all major desktop systems, so documents look the same everywhere. */
export const FONT_FAMILIES = [
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'system-ui',
  'serif',
  'monospace',
] as const;

export const FONT_WEIGHTS = [
  { value: 100, label: 'Thin' },
  { value: 200, label: 'Extra Light' },
  { value: 300, label: 'Light' },
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Medium' },
  { value: 600, label: 'Semi Bold' },
  { value: 700, label: 'Bold' },
  { value: 800, label: 'Extra Bold' },
  { value: 900, label: 'Black' },
] as const;

/**
 * Measures text. `width` is null for unconstrained (single-line-per-paragraph) layout;
 * otherwise text wraps at `width`. Returns the laid-out size.
 */
export type TextMeasure = (node: TextNode, width: number | null) => { width: number; height: number };

/**
 * Resizes every auto-sized text box to fit its content. Unchanged boxes are not written,
 * so this is safe to run after every edit (it produces no undo entries on its own).
 */
export function layoutTexts(doc: DesignDocument, measure: TextMeasure): void {
  for (const node of Object.values(doc.nodes)) {
    if (node.type !== 'text' || node.autoResize === 'none') continue;
    const size = measure(node, node.autoResize === 'height' ? node.width : null);
    const width = node.autoResize === 'height' ? node.width : round(Math.max(1, size.width), 2);
    const height = round(Math.max(1, size.height), 2);
    if (node.width !== width) node.width = width;
    if (node.height !== height) node.height = height;
  }
}
