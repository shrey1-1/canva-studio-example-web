/**
 * Auto Layout: frames with `layout` place their visible children in a row or column with
 * padding, gap and alignment. Children can be fixed size, or "fill" the space left; the frame
 * can be fixed or "hug" its content. Min/max sizes clamp the result.
 *
 * Runs after every edit (see finalize.ts). Only real changes are written.
 */
import { round } from './geometry';
import { isContainer, type AutoLayout, type DesignDocument, type FrameLikeNode, type NodeId, type SceneNode } from './model';
import { resizeNode } from './structure';

export const DEFAULT_AUTO_LAYOUT: AutoLayout = {
  direction: 'vertical',
  gap: 10,
  paddingTop: 10,
  paddingRight: 10,
  paddingBottom: 10,
  paddingLeft: 10,
  primaryAlign: 'start',
  counterAlign: 'start',
};

const clamp = (v: number, min: number | null, max: number | null) => Math.max(min ?? 0, Math.min(max ?? Infinity, v));

function setSize(doc: DesignDocument, node: SceneNode, width: number, height: number) {
  const w = round(width, 4);
  const h = node.type === 'line' ? 0 : round(height, 4);
  if (w !== node.width || h !== node.height) resizeNode(doc, node.id, w, h, { manual: false });
}

function layoutFrame(doc: DesignDocument, f: FrameLikeNode, L: AutoLayout) {
  const horiz = L.direction === 'horizontal';
  const kids = f.childIds.map((id) => doc.nodes[id]).filter((n): n is SceneNode => !!n && n.visible);
  const mainOf = (n: SceneNode) => (horiz ? n.width : n.height);
  const crossOf = (n: SceneNode) => (horiz ? n.height : n.width);
  const mainMode = (n: SceneNode) => (horiz ? n.sizing.horizontal : n.sizing.vertical);
  const crossMode = (n: SceneNode) => (horiz ? n.sizing.vertical : n.sizing.horizontal);
  const padStart = horiz ? L.paddingLeft : L.paddingTop;
  const padEnd = horiz ? L.paddingRight : L.paddingBottom;
  const crossStart = horiz ? L.paddingTop : L.paddingLeft;
  const crossEnd = horiz ? L.paddingBottom : L.paddingRight;
  const gaps = L.primaryAlign === 'space-between' ? 0 : L.gap * Math.max(0, kids.length - 1);
  const frameHugsMain = mainMode(f) === 'hug';
  const frameHugsCross = crossMode(f) === 'hug';

  // Text that fills the width wraps inside it.
  for (const k of kids) {
    if (k.type === 'text' && k.autoResize === 'width-and-height' && (k.sizing.horizontal === 'fill' || (!horiz && crossMode(k) === 'fill'))) {
      k.autoResize = 'height';
    }
  }

  const fillers = kids.filter((k) => mainMode(k) === 'fill' && !frameHugsMain);
  const fixedMain = kids.filter((k) => !fillers.includes(k)).reduce((s, k) => s + mainOf(k), 0);

  // Frame size along the main axis.
  let fMain = horiz ? f.width : f.height;
  if (frameHugsMain) {
    const content = kids.reduce((s, k) => s + mainOf(k), 0) + (L.primaryAlign === 'space-between' ? L.gap * Math.max(0, kids.length - 1) : gaps);
    fMain = padStart + content + padEnd;
  }
  fMain = clamp(fMain, horiz ? f.minWidth : f.minHeight, horiz ? f.maxWidth : f.maxHeight);

  // Share the remaining space between "fill" children.
  if (fillers.length) {
    const spacing = L.primaryAlign === 'space-between' ? L.gap * Math.max(0, kids.length - 1) : gaps;
    const share = Math.max(0, fMain - padStart - padEnd - spacing - fixedMain) / fillers.length;
    for (const k of fillers) {
      const main = clamp(share, horiz ? k.minWidth : k.minHeight, horiz ? k.maxWidth : k.maxHeight);
      setSize(doc, k, horiz ? main : k.width, horiz ? k.height : main);
    }
  }

  // Frame size across.
  let fCross = horiz ? f.height : f.width;
  if (frameHugsCross) {
    // If every child fills across, they keep their current size instead of collapsing to 0.
    const sized = kids.filter((k) => crossMode(k) !== 'fill');
    const basis = sized.length ? sized : kids;
    fCross = crossStart + (basis.length ? Math.max(...basis.map(crossOf)) : 0) + crossEnd;
  }
  fCross = clamp(fCross, horiz ? f.minHeight : f.minWidth, horiz ? f.maxHeight : f.maxWidth);
  const crossInner = Math.max(0, fCross - crossStart - crossEnd);
  for (const k of kids) {
    if (crossMode(k) !== 'fill') continue;
    const cross = clamp(crossInner, horiz ? k.minHeight : k.minWidth, horiz ? k.maxHeight : k.maxWidth);
    setSize(doc, k, horiz ? k.width : cross, horiz ? cross : k.height);
  }

  setSize(doc, f, horiz ? fMain : fCross, horiz ? fCross : fMain);

  // Positions.
  const total = kids.reduce((s, k) => s + mainOf(k), 0);
  let gap = L.gap;
  let cursor = padStart;
  const free = fMain - padStart - padEnd - total - L.gap * Math.max(0, kids.length - 1);
  if (L.primaryAlign === 'center') cursor += free / 2;
  else if (L.primaryAlign === 'end') cursor += free;
  else if (L.primaryAlign === 'space-between' && kids.length > 1) gap = (fMain - padStart - padEnd - total) / (kids.length - 1);
  for (const k of kids) {
    const space = crossInner - crossOf(k);
    const cross = crossStart + (L.counterAlign === 'center' ? space / 2 : L.counterAlign === 'end' ? space : 0);
    const x = round(horiz ? cursor : cross, 4);
    const y = round(horiz ? cross : cursor, 4);
    if (k.x !== x) k.x = x;
    if (k.y !== y) k.y = y;
    // Auto layout places unrotated boxes; lines keep their direction (it is their rotation).
    if (k.rotation !== 0 && k.type !== 'line') k.rotation = 0;
    cursor += mainOf(k) + gap;
  }
}

/** Lays out every auto-layout frame, children before parents (so "hug" sizes are known). */
export function layoutAutoFrames(doc: DesignDocument): void {
  const visit = (ids: readonly NodeId[]) => {
    for (const id of ids) {
      const node = doc.nodes[id];
      if (!node || !isContainer(node)) continue;
      visit(node.childIds);
      if (node.type !== 'group' && node.layout) layoutFrame(doc, node, node.layout);
    }
  };
  for (const page of doc.pages) visit(page.childIds);
}

/** Index a dragged child should take in an auto-layout frame, from a point in the frame's space. */
export function autoLayoutIndexAt(doc: DesignDocument, frameId: NodeId, local: { x: number; y: number }, exclude: ReadonlySet<NodeId>): number {
  const f = doc.nodes[frameId];
  if (!f || f.type === 'group' || !isContainer(f) || !f.layout) return 0;
  const horiz = f.layout.direction === 'horizontal';
  const others = f.childIds.filter((id) => !exclude.has(id) && doc.nodes[id]?.visible);
  let index = 0;
  for (const id of others) {
    const n = doc.nodes[id]!;
    const mid = horiz ? n.x + n.width / 2 : n.y + n.height / 2;
    if ((horiz ? local.x : local.y) > mid) index++;
  }
  // Convert from "index among visible others" to index in the full child list without the moved ones.
  const all = f.childIds.filter((id) => !exclude.has(id));
  const anchor = others[index];
  return anchor ? all.indexOf(anchor) : all.length;
}

/** Common screen sizes for responsive frames. */
export const FRAME_PRESETS: readonly { group: string; name: string; width: number; height: number }[] = [
  { group: 'Phone', name: 'iPhone 16', width: 393, height: 852 },
  { group: 'Phone', name: 'iPhone 16 Pro Max', width: 440, height: 956 },
  { group: 'Phone', name: 'iPhone SE', width: 375, height: 667 },
  { group: 'Phone', name: 'Android Compact', width: 412, height: 917 },
  { group: 'Phone', name: 'Android Medium', width: 700, height: 840 },
  { group: 'Tablet', name: 'iPad mini', width: 744, height: 1133 },
  { group: 'Tablet', name: 'iPad Pro 11"', width: 834, height: 1194 },
  { group: 'Tablet', name: 'Surface Pro', width: 912, height: 1368 },
  { group: 'Desktop', name: 'Desktop', width: 1440, height: 1024 },
  { group: 'Desktop', name: 'MacBook Air', width: 1280, height: 832 },
  { group: 'Desktop', name: 'Wide desktop', width: 1920, height: 1080 },
  { group: 'Presentation', name: 'Slide 16:9', width: 1920, height: 1080 },
  { group: 'Presentation', name: 'Slide 4:3', width: 1024, height: 768 },
  { group: 'Social', name: 'Instagram post', width: 1080, height: 1080 },
  { group: 'Social', name: 'Instagram story', width: 1080, height: 1920 },
];
