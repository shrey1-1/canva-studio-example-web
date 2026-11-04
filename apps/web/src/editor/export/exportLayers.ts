/**
 * Exports layers as PNG / JPG (rendered by the canvas), SVG (vector, core `exportSvg`) or PDF
 * (one page per layer, core `buildPdf`). Everything runs in the browser; nothing is uploaded.
 */
import Konva from 'konva';
import { buildPdf, exportSvg, type NodeId } from '@canvas-studio/core';
import { assetStore } from '../../persistence/assetStore';
import { useEditor } from '../../state/editorStore';
import { downloadFile } from '../plugins/imageIO';

export type ExportFormat = 'png' | 'jpg' | 'svg' | 'pdf';
export const EXPORT_SCALES = [0.5, 1, 2, 3, 4] as const;
/** Largest side of a raster export, so a huge frame at 4x cannot exhaust memory. */
const MAX_SIDE = 16_384;

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 100) || 'export';

/** Draws one layer to a canvas at `scale` (independent of the current zoom). */
async function renderLayer(id: NodeId, scale: number, background?: string): Promise<HTMLCanvasElement> {
  // Let the canvas finish drawing anything that just changed.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const node = Konva.stages[0]?.findOne(`#${id}`);
  if (!node) throw new Error('Only layers on the current page can be exported.');
  const zoom = useEditor.getState().viewport.zoom;
  const box = node.getClientRect();
  const ratio = Math.min(scale / zoom, MAX_SIDE / Math.max(1, box.width), MAX_SIDE / Math.max(1, box.height));
  const canvas = node.toCanvas({ pixelRatio: ratio });
  if (!background) return canvas;
  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(canvas, 0, 0);
  return flat;
}

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed (image too large?)'))), type, 0.92));

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('Could not read image'));
    r.readAsDataURL(blob);
  });

/** Exports the layers; returns how many files were saved. */
export async function exportLayers(ids: readonly NodeId[], format: ExportFormat, scale = 1): Promise<number> {
  const { doc } = useEditor.getState();
  const nodes = ids.map((id) => doc.nodes[id]).filter((n) => n && n.visible);
  if (!nodes.length) throw new Error('Select visible layers to export.');

  if (format === 'svg') {
    // Embed the images the layers use.
    const hrefs = new Map<string, string>();
    for (const n of Object.values(doc.nodes)) {
      if (n.type !== 'image' || hrefs.has(n.assetId)) continue;
      const record = await assetStore.get(n.assetId).catch(() => undefined);
      if (record) hrefs.set(n.assetId, await blobToDataUrl(record.blob));
    }
    const svg = exportSvg(doc, nodes.map((n) => n!.id), { imageHref: (id) => hrefs.get(id) });
    if (!svg) throw new Error('Nothing visible to export.');
    downloadFile(`${safeName(nodes.length === 1 ? nodes[0]!.name : doc.name)}.svg`, svg, 'image/svg+xml');
    return 1;
  }

  if (format === 'pdf') {
    const pages = [];
    for (const n of nodes) {
      const canvas = await renderLayer(n!.id, scale, '#FFFFFF');
      const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg')).arrayBuffer());
      pages.push({ width: canvas.width / scale, height: canvas.height / scale, jpeg, pixelWidth: canvas.width, pixelHeight: canvas.height });
    }
    const pdf = buildPdf(pages, doc.name);
    downloadFile(`${safeName(doc.name)}.pdf`, new Blob([pdf as BlobPart], { type: 'application/pdf' }));
    return 1;
  }

  for (const n of nodes) {
    const canvas = await renderLayer(n!.id, scale, format === 'jpg' ? '#FFFFFF' : undefined);
    const blob = await toBlob(canvas, format === 'jpg' ? 'image/jpeg' : 'image/png');
    downloadFile(`${safeName(n!.name)}${scale === 1 ? '' : `@${scale}x`}.${format}`, blob);
  }
  return nodes.length;
}
