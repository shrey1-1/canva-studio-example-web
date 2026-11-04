/**
 * The 13 built-in tools. They are first-party code, but they still go through the same
 * permission-checked ToolContext as sandboxed custom tools.
 */
import {
  DEVICES,
  MOCKUP_TEMPLATES,
  STICKERS,
  TOKEN_FILE_EXT,
  bentoGrid,
  collectTokens,
  formatTokens,
  isFrameLike,
  pixelStretch,
  renderAirbrush,
  renderClouds,
  renderFractalNoise,
  renderNebula,
  resizeNode,
  selectionBounds,
  traceImage,
  tracedToSvg,
  type DesignDocument,
  type NodeId,
  type SceneNode,
  type TokenFormat,
} from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import type { ToolContext } from './toolHost';

export type ParamValue = string | number | boolean;

export interface ToolParam {
  key: string;
  label: string;
  type: 'number' | 'color' | 'select' | 'boolean';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export type PlayerMode = 'slides' | 'flipbook';

export interface ToolResult {
  message: string;
  /** Text output shown in the dialog with Copy / Download. */
  text?: { content: string; filename: string };
  /** Opens the in-app player. */
  player?: { mode: PlayerMode; pages: string[]; transition: string; duration: number; autoAdvance: number };
}

export interface BuiltinTool {
  id: string;
  /** Shown above the form, e.g. what to select first. */
  hint?: string;
  params: ToolParam[];
  run(ctx: ToolContext, values: Record<string, ParamValue>): Promise<ToolResult>;
}

const seed: ToolParam = { key: 'seed', label: 'Seed', type: 'number', default: 1, min: 0, max: 99999, step: 1 };
const size = (w: number, h: number): ToolParam[] => [
  { key: 'width', label: 'Width', type: 'number', default: w, min: 16, max: 2048, step: 1 },
  { key: 'height', label: 'Height', type: 'number', default: h, min: 16, max: 2048, step: 1 },
];
const n = (v: ParamValue | undefined) => Number(v ?? 0);
const s = (v: ParamValue | undefined) => String(v ?? '');

function requireSelection(ctx: ToolContext, test: (node: SceneNode) => boolean, what: string): SceneNode[] {
  const sel = ctx.getSelection().filter(test);
  if (sel.length === 0) throw new Error(`Select ${what} first.`);
  return sel;
}

/** Where to place generated output: inside a selected frame (filling it), or at the screen centre. */
function imageTarget(ctx: ToolContext, values: Record<string, ParamValue>) {
  const { doc, selection } = useEditor.getState();
  const only = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
  if (only && isFrameLike(only) && only.type !== 'instance' && only.type !== 'component-set') {
    const w = Math.min(2048, Math.round(only.width));
    const h = Math.min(2048, Math.round(only.height));
    return { width: w, height: h, place: { parentId: only.id, x: 0, y: 0, width: only.width, height: only.height } };
  }
  void ctx;
  return { width: n(values.width), height: n(values.height), place: {} };
}

/** Page position just right of the given layers. */
function besides(doc: DesignDocument, ids: NodeId[]) {
  const b = selectionBounds(doc, ids);
  return b ? { x: Math.round(b.x + b.width + 80), y: Math.round(b.y) } : { x: 0, y: 0 };
}

async function frameSnapshots(ctx: ToolContext, onlySelected: boolean): Promise<{ ids: NodeId[]; pages: string[] }> {
  const { doc, selection, activePageId } = useEditor.getState();
  const page = doc.pages.find((p) => p.id === activePageId)!;
  let ids = selection.filter((id) => isFrameLike(doc.nodes[id]));
  if (ids.length === 0 && !onlySelected) ids = page.childIds.filter((id) => isFrameLike(doc.nodes[id]) && doc.nodes[id]!.visible);
  if (ids.length === 0) throw new Error('Add or select at least one frame.');
  ids.sort((a, b) => doc.nodes[a]!.y - doc.nodes[b]!.y || doc.nodes[a]!.x - doc.nodes[b]!.x);
  const pages: string[] = [];
  for (const id of ids) pages.push(await ctx.snapshot(id, 1.5));
  return { ids, pages };
}

/** Copies a layer into a "screen" frame, filling it (frames) or fitting it (other layers). */
function fitInto(ctx: ToolContext, sourceId: NodeId, screenId: NodeId, w: number, h: number) {
  const copy = ctx.copyInto(sourceId, screenId, { x: 0, y: 0 });
  ctx.editDocument('create-nodes', (d) => {
    const node = d.nodes[copy]!;
    if (isFrameLike(node)) {
      resizeNode(d, copy, w, h);
    } else {
      const k = Math.min(w / Math.max(1, node.width), h / Math.max(1, node.height));
      resizeNode(d, copy, node.width * k, node.height * k);
      node.x = (w - node.width) / 2;
      node.y = (h - node.height) / 2;
    }
  });
  return copy;
}

export const BUILTIN_TOOLS: Record<string, BuiltinTool> = {
  'image-to-vector': {
    id: 'image-to-vector',
    hint: 'Select an image layer.',
    params: [
      { key: 'colors', label: 'Colours', type: 'number', default: 6, min: 2, max: 12, step: 1 },
      { key: 'detail', label: 'Smoothing', type: 'number', default: 1, min: 0, max: 6, step: 0.5 },
      { key: 'minArea', label: 'Ignore specks smaller than (px²)', type: 'number', default: 12, min: 0, max: 500, step: 1 },
      { key: 'output', label: 'Output', type: 'select', default: 'layers', options: [{ value: 'layers', label: 'Vector layers' }, { value: 'svg', label: 'SVG file' }, { value: 'both', label: 'Both' }] },
    ],
    async run(ctx, v) {
      const [img] = requireSelection(ctx, (x) => x.type === 'image', 'an image');
      const px = await ctx.readImage(img!.id, 320);
      const paths = traceImage(px, { colors: n(v.colors), detail: n(v.detail), minArea: n(v.minArea) });
      if (paths.length === 0) throw new Error('Nothing to trace (the image may be fully transparent).');
      if (v.output !== 'layers') ctx.download(`${img!.name}.svg`, tracedToSvg(paths, px.width, px.height), 'image/svg+xml');
      if (v.output === 'svg') return { message: `Exported ${paths.length} paths as SVG.` };
      const k = img!.width / px.width;
      const at = besides(useEditor.getState().doc, [img!.id]);
      const ids = ctx.createNodes([
        { type: 'frame', name: `${img!.name} (vector)`, x: at.x, y: at.y, width: img!.width, height: img!.height, fill: null, clipContent: true },
        ...paths.map((p, i) => ({ type: 'vector', parent: '#0', name: `Shape ${i + 1}`, fill: p.color, stroke: null, points: p.points.map((q) => [q.x * k, q.y * k]) })),
      ]);
      ctx.select([ids[0]!]);
      return { message: `Traced ${paths.length} shapes in ${new Set(paths.map((p) => p.color)).size} colours.` };
    },
  },

  'bento-grid': {
    id: 'bento-grid',
    params: [
      ...size(960, 640),
      { key: 'columns', label: 'Columns', type: 'number', default: 4, min: 1, max: 12, step: 1 },
      { key: 'rows', label: 'Rows', type: 'number', default: 3, min: 1, max: 12, step: 1 },
      { key: 'gap', label: 'Gap', type: 'number', default: 16, min: 0, max: 200, step: 1 },
      { key: 'radius', label: 'Corner radius', type: 'number', default: 20, min: 0, max: 200, step: 1 },
      { key: 'variety', label: 'Mixed sizes (0–1)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'card', label: 'Card colour', type: 'color', default: '#E4E4E7' },
      { key: 'background', label: 'Background', type: 'color', default: '#FFFFFF' },
      seed,
    ],
    async run(ctx, v) {
      const gap = n(v.gap);
      const cards = bentoGrid({ width: n(v.width), height: n(v.height), columns: n(v.columns), rows: n(v.rows), gap, variety: n(v.variety), seed: n(v.seed) });
      const c = ctx.viewportCenter();
      const W = n(v.width) + gap * 2;
      const H = n(v.height) + gap * 2;
      const ids = ctx.createNodes([
        { type: 'frame', name: 'Bento grid', x: Math.round(c.x - W / 2), y: Math.round(c.y - H / 2), width: W, height: H, fill: s(v.background), cornerRadius: n(v.radius) + gap / 2 },
        ...cards.map((r, i) => ({ type: 'rectangle', parent: '#0', name: `Card ${i + 1}`, x: r.x + gap, y: r.y + gap, width: r.width, height: r.height, fill: s(v.card), cornerRadius: n(v.radius) })),
      ]);
      ctx.select([ids[0]!]);
      return { message: `Created a grid with ${cards.length} cards.` };
    },
  },

  'phone-mockup': {
    id: 'phone-mockup',
    hint: 'Select the frames (or images) to show on the phone screen.',
    params: [
      { key: 'device', label: 'Device', type: 'select', default: DEVICES[0]!.id, options: DEVICES.map((d) => ({ value: d.id, label: `${d.name} (${d.screenWidth}×${d.screenHeight})` })) },
      { key: 'body', label: 'Body colour', type: 'color', default: '#111114' },
    ],
    async run(ctx, v) {
      const sel = requireSelection(ctx, () => true, 'one or more layers').slice(0, 10);
      const dev = DEVICES.find((d) => d.id === v.device) ?? DEVICES[0]!;
      const top = dev.homeButton ? 80 : dev.bezel;
      const W = dev.screenWidth + dev.bezel * 2;
      const H = dev.screenHeight + top * 2;
      let at = besides(useEditor.getState().doc, sel.map((x) => x.id));
      const made: NodeId[] = [];
      for (const src of sel) {
        const [frame, , screen] = ctx.createNodes([
          { type: 'frame', name: `${dev.name} – ${src.name}`, x: at.x, y: at.y, width: W, height: H, fill: null, clipContent: false },
          { type: 'rectangle', parent: '#0', name: 'Body', width: W, height: H, cornerRadius: dev.radius, fill: s(v.body), stroke: { color: '#3F3F46', width: 2 } },
          { type: 'frame', parent: '#0', name: 'Screen', x: dev.bezel, y: top, width: dev.screenWidth, height: dev.screenHeight, fill: '#000000', cornerRadius: dev.homeButton ? 0 : dev.radius - dev.bezel, clipContent: true },
        ]) as [NodeId, NodeId, NodeId];
        fitInto(ctx, src.id, screen, dev.screenWidth, dev.screenHeight);
        const extras: unknown[] = [
          { type: 'rectangle', parent: frame, name: 'Side button', x: -3, y: H * 0.22, width: 3, height: 60, fill: s(v.body), cornerRadius: 2 },
          { type: 'rectangle', parent: frame, name: 'Power button', x: W, y: H * 0.26, width: 3, height: 90, fill: s(v.body), cornerRadius: 2 },
        ];
        if (dev.camera === 'island') extras.push({ type: 'rectangle', parent: frame, name: 'Dynamic island', x: (W - 124) / 2, y: top + 11, width: 124, height: 36, fill: '#000000', cornerRadius: 18 });
        if (dev.camera === 'punch-hole') extras.push({ type: 'ellipse', parent: frame, name: 'Camera', x: (W - 14) / 2, y: top + 12, width: 14, height: 14, fill: '#000000' });
        if (dev.homeButton) extras.push({ type: 'ellipse', parent: frame, name: 'Home button', x: (W - 56) / 2, y: H - top / 2 - 28, width: 56, height: 56, fill: null, stroke: { color: '#52525B', width: 2 } });
        ctx.createNodes(extras);
        made.push(frame);
        at = { x: at.x + W + 60, y: at.y };
      }
      ctx.select(made);
      return { message: `Created ${made.length} ${dev.name} mockup${made.length === 1 ? '' : 's'}.` };
    },
  },

  'auto-slide': {
    id: 'auto-slide',
    hint: 'Select frames in order, or leave nothing selected to use every top-level frame on the page.',
    params: [
      { key: 'transition', label: 'Transition', type: 'select', default: 'slide', options: [{ value: 'slide', label: 'Slide (movement)' }, { value: 'fade', label: 'Fade (opacity)' }, { value: 'push', label: 'Push up' }, { value: 'zoom', label: 'Zoom' }] },
      { key: 'duration', label: 'Transition (ms)', type: 'number', default: 500, min: 100, max: 3000, step: 50 },
      { key: 'autoAdvance', label: 'Auto-advance (s, 0 = manual)', type: 'number', default: 3, min: 0, max: 60, step: 0.5 },
      { key: 'arrange', label: 'Line the frames up in order', type: 'boolean', default: true },
      { key: 'rename', label: 'Rename to "Slide 1", "Slide 2"…', type: 'boolean', default: false },
    ],
    async run(ctx, v) {
      const { ids, pages } = await frameSnapshots(ctx, false);
      if (v.arrange || v.rename) {
        const doc = useEditor.getState().doc;
        let x = doc.nodes[ids[0]!]!.x;
        const y = doc.nodes[ids[0]!]!.y;
        ctx.updateNodes(
          ids.map((id, i) => {
            const node = doc.nodes[id]!;
            const patch: Record<string, unknown> = { id };
            if (v.arrange) {
              patch.x = x;
              patch.y = y;
              x += node.width + 100;
            }
            if (v.rename) patch.name = `Slide ${i + 1}`;
            return patch;
          }),
        );
      }
      return {
        message: `Playing ${pages.length} slides.`,
        player: { mode: 'slides', pages, transition: s(v.transition), duration: n(v.duration), autoAdvance: n(v.autoAdvance) },
      };
    },
  },

  flipbook: {
    id: 'flipbook',
    hint: 'Uses the selected frames, or every top-level frame on the page.',
    params: [{ key: 'duration', label: 'Page turn (ms)', type: 'number', default: 700, min: 200, max: 3000, step: 50 }],
    async run(ctx, v) {
      const { pages } = await frameSnapshots(ctx, false);
      return { message: `Opened a ${pages.length}-page flipbook.`, player: { mode: 'flipbook', pages, transition: 'flip', duration: n(v.duration), autoAdvance: 0 } };
    },
  },

  'sticker-pack': {
    id: 'sticker-pack',
    params: [
      { key: 'sticker', label: 'Sticker', type: 'select', default: 'star', options: Object.entries(STICKERS).map(([value, x]) => ({ value, label: x.name })) },
      { key: 'size', label: 'Size', type: 'number', default: 160, min: 16, max: 2000, step: 1 },
      { key: 'ownColor', label: "Use the sticker's colour", type: 'boolean', default: true },
      { key: 'color', label: 'Colour', type: 'color', default: '#3B82F6' },
      { key: 'outline', label: 'White outline + shadow', type: 'boolean', default: true },
    ],
    async run(ctx, v) {
      const st = STICKERS[s(v.sticker)] ?? STICKERS.star!;
      const k = n(v.size) / 100;
      const c = ctx.viewportCenter();
      const [id] = ctx.createNodes([
        {
          type: 'vector',
          name: `${st.name} sticker`,
          x: c.x - n(v.size) / 2,
          y: c.y - n(v.size) / 2,
          points: st.points.map(([x, y]) => [x * k, y * k]),
          fill: v.ownColor ? st.color : s(v.color),
          stroke: v.outline ? { color: '#FFFFFF', width: Math.max(2, n(v.size) / 25) } : null,
          shadow: v.outline ? { color: '#000000', x: 0, y: 4, blur: 10, opacity: 0.3 } : null,
        },
      ]);
      ctx.select([id!]);
      return { message: `Inserted a ${st.name} sticker.` };
    },
  },

  'token-exporter': {
    id: 'token-exporter',
    params: [
      { key: 'format', label: 'Format', type: 'select', default: 'css', options: [{ value: 'json', label: 'JSON' }, { value: 'css', label: 'CSS variables' }, { value: 'scss', label: 'SCSS' }, { value: 'js', label: 'JavaScript' }] },
      { key: 'download', label: 'Download the file', type: 'boolean', default: false },
    ],
    async run(ctx, v) {
      const doc = ctx.getDocument() as unknown as DesignDocument;
      const tokens = collectTokens(doc);
      const format = s(v.format) as TokenFormat;
      const content = formatTokens(tokens, format);
      const filename = `${doc.name.replace(/[^\w-]+/g, '-') || 'tokens'}-tokens.${TOKEN_FILE_EXT[format]}`;
      if (v.download) ctx.download(filename, content, format === 'json' ? 'application/json' : 'text/plain');
      const count = Object.values(tokens).reduce((sum, group) => sum + Object.keys(group).length, 0);
      return { message: `Exported ${count} tokens.`, text: { content, filename } };
    },
  },

  'generate-mockup': {
    id: 'generate-mockup',
    hint: 'Select the design (frame or image) to place in the mockup.',
    params: [
      { key: 'template', label: 'Template', type: 'select', default: 'browser', options: MOCKUP_TEMPLATES.map((t) => ({ value: t.id, label: t.name })) },
      { key: 'background', label: 'Scene background', type: 'color', default: '#E9EEF5' },
      { key: 'exportPng', label: 'Export as PNG', type: 'boolean', default: false },
    ],
    async run(ctx, v) {
      const [src] = requireSelection(ctx, () => true, 'a design');
      const t = MOCKUP_TEMPLATES.find((x) => x.id === v.template) ?? MOCKUP_TEMPLATES[0]!;
      const pad = 80;
      const chromeTop = t.id === 'browser' ? 44 : t.id === 'laptop' ? 24 : t.id === 'tablet' ? 28 : 40;
      const side = t.id === 'browser' ? 0 : t.id === 'poster' ? 40 : 24;
      const bodyW = t.screenWidth + side * 2;
      const bodyH = t.screenHeight + chromeTop + (t.id === 'browser' ? 0 : side || chromeTop);
      const base = t.id === 'laptop' ? 40 : 0;
      const W = bodyW + pad * 2 + (t.id === 'laptop' ? 160 : 0);
      const H = bodyH + pad * 2 + base;
      const at = besides(useEditor.getState().doc, [src!.id]);
      const bx = (W - bodyW) / 2;
      const specs: unknown[] = [
        { type: 'frame', name: `${t.name} mockup`, x: at.x, y: at.y, width: W, height: H, fill: s(v.background), clipContent: true },
        {
          type: 'rectangle', parent: '#0', name: 'Device', x: bx, y: pad, width: bodyW, height: bodyH,
          fill: t.id === 'browser' ? '#F4F4F5' : t.id === 'poster' ? '#FFFFFF' : '#1F1F23',
          cornerRadius: t.id === 'browser' ? 12 : t.id === 'poster' ? 2 : 22,
          stroke: t.id === 'poster' ? { color: '#27272A', width: 14 } : null,
          shadow: { color: '#000000', x: 0, y: 24, blur: 48, opacity: 0.22 },
        },
        { type: 'frame', parent: '#0', name: 'Screen', x: bx + side, y: pad + chromeTop, width: t.screenWidth, height: t.screenHeight, fill: '#FFFFFF', clipContent: true },
      ];
      if (t.id === 'browser') {
        ['#FF5F57', '#FEBC2E', '#28C840'].forEach((color, i) => specs.push({ type: 'ellipse', parent: '#0', name: 'Window button', x: bx + 16 + i * 20, y: pad + 16, width: 12, height: 12, fill: color }));
        specs.push({ type: 'rectangle', parent: '#0', name: 'Address bar', x: bx + bodyW * 0.3, y: pad + 10, width: bodyW * 0.4, height: 24, fill: '#E4E4E7', cornerRadius: 12 });
      }
      if (t.id === 'laptop') specs.push({ type: 'rectangle', parent: '#0', name: 'Base', x: bx - 80, y: pad + bodyH, width: bodyW + 160, height: base, fill: '#A1A1AA', cornerRadius: 12 });
      const ids = ctx.createNodes(specs);
      fitInto(ctx, src!.id, ids[2]!, t.screenWidth, t.screenHeight);
      ctx.select([ids[0]!]);
      if (v.exportPng) ctx.download(`${t.name} mockup.png`, await ctx.exportNodePng(ids[0]!));
      return { message: `Created a ${t.name.toLowerCase()} mockup${v.exportPng ? ' and exported it' : ''}.` };
    },
  },

  nebula: {
    id: 'nebula',
    hint: 'Select a frame to fill it, or generate at the size below.',
    params: [
      ...size(1200, 800),
      { key: 'colorA', label: 'Colour 1', type: 'color', default: '#7C3AED' },
      { key: 'colorB', label: 'Colour 2', type: 'color', default: '#EC4899' },
      { key: 'background', label: 'Space', type: 'color', default: '#05010F' },
      { key: 'density', label: 'Cloud density (0–1)', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05 },
      { key: 'stars', label: 'Stars (per 10k px)', type: 'number', default: 12, min: 0, max: 200, step: 1 },
      seed,
    ],
    async run(ctx, v) {
      const t = imageTarget(ctx, v);
      const px = renderNebula({ width: t.width, height: t.height, colorA: s(v.colorA), colorB: s(v.colorB), background: s(v.background), density: n(v.density), stars: n(v.stars), seed: n(v.seed) });
      ctx.select([await ctx.placeImage(px, { name: 'Nebula', ...t.place })]);
      return { message: `Generated a ${px.width}×${px.height} nebula.` };
    },
  },

  'pixel-stretch': {
    id: 'pixel-stretch',
    hint: 'Select an image layer.',
    params: [
      { key: 'direction', label: 'Stretch', type: 'select', default: 'vertical', options: [{ value: 'vertical', label: 'A row, downwards/upwards' }, { value: 'horizontal', label: 'A column, sideways' }] },
      { key: 'position', label: 'Source line (0–1)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'length', label: 'Length (0–1)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { key: 'side', label: 'Direction', type: 'select', default: 'after', options: [{ value: 'after', label: 'Down / right' }, { value: 'before', label: 'Up / left' }, { value: 'both', label: 'Both ways' }] },
    ],
    async run(ctx, v) {
      const [img] = requireSelection(ctx, (x) => x.type === 'image', 'an image');
      const px = await ctx.readImage(img!.id, 2048);
      const out = pixelStretch(px, { direction: s(v.direction) as 'horizontal' | 'vertical', position: n(v.position), length: n(v.length), side: s(v.side) as 'after' });
      const at = besides(useEditor.getState().doc, [img!.id]);
      ctx.select([await ctx.placeImage(out, { name: `${img!.name} (stretched)`, x: at.x, y: at.y, width: img!.width, height: img!.height })]);
      return { message: 'Created a stretched copy next to the image.' };
    },
  },

  'fractal-noise': {
    id: 'fractal-noise',
    hint: 'Select a frame to fill it, or generate at the size below.',
    params: [
      ...size(800, 600),
      { key: 'scale', label: 'Scale (px)', type: 'number', default: 120, min: 2, max: 2000, step: 1 },
      { key: 'frequency', label: 'Frequency', type: 'number', default: 2, min: 1, max: 4, step: 0.1 },
      { key: 'octaves', label: 'Octaves', type: 'number', default: 5, min: 1, max: 10, step: 1 },
      { key: 'amplitude', label: 'Amplitude (0–1)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'colorA', label: 'Dark', type: 'color', default: '#0F172A' },
      { key: 'colorB', label: 'Light', type: 'color', default: '#E2E8F0' },
      seed,
    ],
    async run(ctx, v) {
      const t = imageTarget(ctx, v);
      const px = renderFractalNoise({ width: t.width, height: t.height, scale: n(v.scale), frequency: n(v.frequency), octaves: n(v.octaves), amplitude: n(v.amplitude), colorA: s(v.colorA), colorB: s(v.colorB), seed: n(v.seed) });
      ctx.select([await ctx.placeImage(px, { name: 'Fractal noise', ...t.place })]);
      return { message: `Generated ${px.width}×${px.height} fractal noise.` };
    },
  },

  'grainy-airbrush': {
    id: 'grainy-airbrush',
    hint: 'Select a frame to fill it, or generate at the size below.',
    params: [
      ...size(800, 600),
      { key: 'color', label: 'Colour', type: 'color', default: '#F97316' },
      { key: 'transparent', label: 'Transparent background', type: 'boolean', default: true },
      { key: 'background', label: 'Background', type: 'color', default: '#FFF7ED' },
      { key: 'brush', label: 'Brush size', type: 'number', default: 180, min: 4, max: 1000, step: 1 },
      { key: 'grain', label: 'Grain (0–1)', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05 },
      { key: 'opacity', label: 'Opacity (0–1)', type: 'number', default: 0.9, min: 0, max: 1, step: 0.05 },
      { key: 'strokes', label: 'Strokes', type: 'number', default: 3, min: 1, max: 50, step: 1 },
      seed,
    ],
    async run(ctx, v) {
      const t = imageTarget(ctx, v);
      const px = renderAirbrush({ width: t.width, height: t.height, color: s(v.color), background: v.transparent ? null : s(v.background), size: n(v.brush), grain: n(v.grain), opacity: n(v.opacity), strokes: n(v.strokes), seed: n(v.seed) });
      ctx.select([await ctx.placeImage(px, { name: 'Airbrush', ...t.place })]);
      return { message: `Painted ${n(v.strokes)} airbrush stroke${n(v.strokes) === 1 ? '' : 's'}.` };
    },
  },

  clouds: {
    id: 'clouds',
    hint: 'Select a frame to fill it, or generate at the size below.',
    params: [
      ...size(1200, 600),
      { key: 'sky', label: 'Sky', type: 'color', default: '#60A5FA' },
      { key: 'cloud', label: 'Clouds', type: 'color', default: '#FFFFFF' },
      { key: 'density', label: 'Coverage (0–1)', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'scale', label: 'Cloud size (px)', type: 'number', default: 260, min: 8, max: 2000, step: 1 },
      { key: 'opacity', label: 'Opacity (0–1)', type: 'number', default: 1, min: 0, max: 1, step: 0.05 },
      seed,
    ],
    async run(ctx, v) {
      const t = imageTarget(ctx, v);
      const px = renderClouds({ width: t.width, height: t.height, sky: s(v.sky), cloud: s(v.cloud), density: n(v.density), scale: n(v.scale), opacity: n(v.opacity), seed: n(v.seed) });
      ctx.select([await ctx.placeImage(px, { name: 'Clouds', ...t.place })]);
      return { message: `Generated ${px.width}×${px.height} clouds.` };
    },
  },
};

export const defaultValues = (params: ToolParam[]) => Object.fromEntries(params.map((p) => [p.key, p.default])) as Record<string, ParamValue>;
