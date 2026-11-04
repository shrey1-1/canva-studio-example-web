/**
 * Vector export: renders layers to a standalone SVG string (no browser needed).
 * Covers shapes, frames (with clipping), groups, masks, solid fills/strokes, drop shadows, layer
 * blur, text (one <text> line per paragraph line) and images (embedded via a resolver).
 * Not covered: line end caps (arrows) and automatic wrapping of fixed-width text, which is
 * approximated by explicit line breaks only.
 */
import { localMatrix, nodeOutline, selectionBounds, toSvgPath, worldMatrix, type Matrix } from '../geometry';
import type { DesignDocument, ImageNode, NodeId, SceneNode, TextNode } from '../model';

export interface SvgExportOptions {
  /** Returns an href (usually a data: URL) for an image asset, or undefined to leave it out. */
  imageHref?: (assetId: string) => string | undefined;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => (Math.abs(n) < 1e-9 ? '0' : String(Math.round(n * 1000) / 1000));
const matrixAttr = (m: Matrix) => (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0 ? '' : ` transform="matrix(${m.map(num).join(' ')})"`);

class Writer {
  private n = 0;
  defs: string[] = [];
  constructor(readonly doc: DesignDocument, readonly opts: SvgExportOptions) {}
  id(prefix: string) {
    return `${prefix}${++this.n}`;
  }

  filter(node: SceneNode): string {
    const effects = node.effects.filter((e) => e.visible);
    if (!effects.length) return '';
    const id = this.id('fx');
    const parts: string[] = [];
    for (const e of effects) {
      if (e.type === 'layer-blur') parts.push(`<feGaussianBlur stdDeviation="${num(e.radius / 2)}"/>`);
      else parts.push(`<feDropShadow dx="${num(e.x)}" dy="${num(e.y)}" stdDeviation="${num(e.blur / 2)}" flood-color="${e.color}" flood-opacity="${num(e.opacity)}"/>`);
    }
    this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${parts.join('')}</filter>`);
    return ` filter="url(#${id})"`;
  }

  paint(node: SceneNode, d: string): string {
    let out = '';
    for (const f of node.fills) if (f.visible) out += `<path d="${d}" fill="${f.color}"${f.opacity < 1 ? ` fill-opacity="${num(f.opacity)}"` : ''}/>`;
    for (const s of node.strokes) {
      if (s.visible && s.width > 0) out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${num(s.width)}"${s.opacity < 1 ? ` stroke-opacity="${num(s.opacity)}"` : ''}/>`;
    }
    return out;
  }

  text(node: TextNode): string {
    const fill = node.fills.find((f) => f.visible);
    if (!fill) return '';
    const lineH = node.fontSize * node.lineHeight;
    const anchor = node.textAlign === 'center' ? 'middle' : node.textAlign === 'right' ? 'end' : 'start';
    const x = node.textAlign === 'center' ? node.width / 2 : node.textAlign === 'right' ? node.width : 0;
    const lines = node.characters.split('\n');
    const attrs = [
      `font-family="${esc(node.fontFamily)}, sans-serif"`,
      `font-size="${num(node.fontSize)}"`,
      `font-weight="${node.fontWeight}"`,
      node.italic ? 'font-style="italic"' : '',
      node.letterSpacing ? `letter-spacing="${num(node.letterSpacing)}"` : '',
      node.textDecoration !== 'none' ? `text-decoration="${node.textDecoration}"` : '',
      `fill="${fill.color}"`,
      fill.opacity < 1 ? `fill-opacity="${num(fill.opacity)}"` : '',
      `text-anchor="${anchor}"`,
    ].filter(Boolean).join(' ');
    const tspans = lines
      .map((line, i) => `<tspan x="${num(x)}" y="${num(i * lineH + (lineH - node.fontSize) / 2 + node.fontSize * 0.8)}">${esc(line) || ' '}</tspan>`)
      .join('');
    return `<text ${attrs} xml:space="preserve">${tspans}</text>`;
  }

  image(node: ImageNode): string {
    const href = this.opts.imageHref?.(node.assetId);
    if (!href) return this.paint({ ...node, fills: [{ type: 'solid', color: '#CCCCCC', opacity: 1, visible: true }] }, toSvgPath(nodeOutline(node)));
    const W = node.naturalWidth;
    const H = node.naturalHeight;
    const w = node.width;
    const h = node.height;
    let box = { x: 0, y: 0, width: w, height: h };
    let crop = { x: 0, y: 0, width: W, height: H };
    if (node.fit === 'fit') {
      const s = Math.min(w / W, h / H);
      box = { x: (w - W * s) / 2, y: (h - H * s) / 2, width: W * s, height: H * s };
    } else if (node.fit === 'crop') {
      crop = { x: node.crop.x * W, y: node.crop.y * H, width: node.crop.width * W, height: node.crop.height * H };
    } else if (node.fit === 'fill') {
      const s = Math.max(w / W, h / H) || 1;
      crop = { x: (W - w / s) / 2, y: (H - h / s) / 2, width: w / s, height: h / s };
    }
    const clip = this.id('clip');
    this.defs.push(`<clipPath id="${clip}"><path d="${toSvgPath(nodeOutline(node))}"/></clipPath>`);
    return (
      `<g clip-path="url(#${clip})"><svg x="${num(box.x)}" y="${num(box.y)}" width="${num(box.width)}" height="${num(box.height)}" ` +
      `viewBox="${num(crop.x)} ${num(crop.y)} ${num(crop.width)} ${num(crop.height)}" preserveAspectRatio="none">` +
      `<image width="${W}" height="${H}" href="${esc(href)}"/></svg></g>` +
      this.paint({ ...node, fills: [] }, toSvgPath(nodeOutline(node)))
    );
  }

  /** Siblings in render order; a visible mask clips the siblings above it. */
  children(ids: readonly NodeId[]): string {
    let out = '';
    let i = 0;
    while (i < ids.length) {
      const node = this.doc.nodes[ids[i]!];
      if (node?.isMask && node.visible) {
        const clip = this.id('mask');
        this.defs.push(`<clipPath id="${clip}"><path d="${toSvgPath(nodeOutline(node))}"${matrixAttr(localMatrix(node))}/></clipPath>`);
        out += `<g clip-path="url(#${clip})">${ids.slice(i + 1).map((id) => this.node(id, localMatrix(this.doc.nodes[id]!))).join('')}</g>`;
        break;
      }
      if (node) out += this.node(node.id, localMatrix(node));
      i++;
    }
    return out;
  }

  node(id: NodeId, m: Matrix): string {
    const node = this.doc.nodes[id];
    if (!node || !node.visible || node.isMask) return '';
    const d = toSvgPath(nodeOutline(node));
    let body: string;
    switch (node.type) {
      case 'group':
        body = this.children(node.childIds);
        break;
      case 'frame':
      case 'component':
      case 'component-set':
      case 'instance': {
        let inner = this.children(node.childIds);
        if (node.clipContent && inner) {
          const clip = this.id('clip');
          this.defs.push(`<clipPath id="${clip}"><path d="${d}"/></clipPath>`);
          inner = `<g clip-path="url(#${clip})">${inner}</g>`;
        }
        body = this.paint(node, d) + inner;
        break;
      }
      case 'text':
        body = this.text(node);
        break;
      case 'image':
        body = this.image(node);
        break;
      default:
        body = this.paint(node, d);
    }
    const opacity = node.opacity < 1 ? ` opacity="${num(node.opacity)}"` : '';
    return `<g data-name="${esc(node.name)}"${matrixAttr(m)}${opacity}${this.filter(node)}>${body}</g>`;
  }
}

/** SVG markup for the given layers, cropped to their bounds. Returns null when nothing is visible. */
export function exportSvg(doc: DesignDocument, ids: readonly NodeId[], opts: SvgExportOptions = {}): string | null {
  const roots = ids.filter((id) => doc.nodes[id]?.visible);
  const b = selectionBounds(doc, roots);
  if (!b || b.width <= 0 || b.height <= 0) return null;
  const w = new Writer(doc, opts);
  const body = roots.map((id) => w.node(id, worldMatrix(doc, id))).join('');
  const width = Math.ceil(b.width);
  const height = Math.ceil(b.height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${num(b.x)} ${num(b.y)} ${width} ${height}">` +
    (w.defs.length ? `<defs>${w.defs.join('')}</defs>` : '') +
    body +
    '</svg>'
  );
}
