import type { Pixels } from '@canvas-studio/core';
import { getImageEntry } from '../../persistence/assetStore';

/** Loads an asset's image element (waits for it if it is still loading). */
export async function loadAssetImage(assetId: string): Promise<HTMLImageElement> {
  for (let i = 0; i < 2; i++) {
    const entry = getImageEntry(assetId);
    if (entry.status === 'ready') return entry.image;
    if (entry.status === 'loading') {
      await entry.promise;
      continue;
    }
    break;
  }
  throw new Error('The image is not available in this browser.');
}

/** Reads an image's pixels, scaled down so the longest side is at most `maxSide`. */
export async function readAssetPixels(assetId: string, maxSide = 1024): Promise<Pixels> {
  const img = await loadAssetImage(assetId);
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read image pixels.');
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: data.data };
}

/** Encodes pixels as a PNG file. */
export function pixelsToPng(p: Pixels, name = 'generated.png'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('This browser cannot create images.'));
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(new File([blob], name, { type: 'image/png' })) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
}

/** Saves a file to the user's downloads. */
export function downloadFile(name: string, content: Blob | string, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120) || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
