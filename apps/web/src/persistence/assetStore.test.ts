import { describe, expect, it } from 'vitest';
import { ImageImportError, MAX_IMAGE_BYTES, MemoryAssetStore, importImage, sniffImageType } from './assetStore';

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = (extra = 32) => new Uint8Array([...PNG_HEADER, ...new Array(extra).fill(1)]);
const file = (bytes: Uint8Array, name: string, type = 'image/png') => new File([bytes as Uint8Array<ArrayBuffer>], name, { type });
const decoder = (width: number, height: number) => async () => ({ width, height });

describe('sniffImageType', () => {
  it('recognises formats by content, not name', () => {
    expect(sniffImageType(png())).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffImageType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('importImage', () => {
  it('stores a valid image once, keyed by its content hash', async () => {
    const store = new MemoryAssetStore();
    const a = await importImage(file(png(), 'photo.png'), store, decoder(640, 480));
    const b = await importImage(file(png(), 'copy-of-photo.png'), store, decoder(640, 480));
    expect(a).toMatchObject({ width: 640, height: 480, name: 'photo' });
    expect(a.assetId).toMatch(/^[0-9a-f]{64}$/);
    expect(b.assetId).toBe(a.assetId);
    expect(store.records.size).toBe(1);
    expect(store.records.get(a.assetId)!.mime).toBe('image/png');
  });

  it('rejects disguised, oversized, empty and undecodable files with a reason', async () => {
    const store = new MemoryAssetStore();
    const svg = new TextEncoder().encode('<svg onload="alert(1)"/>');
    await expect(importImage(file(svg, 'evil.png'), store, decoder(1, 1))).rejects.toThrow(/not a PNG/);
    await expect(importImage(file(new Uint8Array(), 'empty.png'), store, decoder(1, 1))).rejects.toThrow(/empty/);
    const big = { size: MAX_IMAGE_BYTES + 1, name: 'huge.png', arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
    await expect(importImage(big, store, decoder(1, 1))).rejects.toThrow(/larger than 20 MB/);
    const broken = async () => {
      throw new Error('decode failed');
    };
    await expect(importImage(file(png(), 'broken.png'), store, broken)).rejects.toThrow(ImageImportError);
    await expect(importImage(file(png(), 'giant.png'), store, decoder(20000, 10))).rejects.toThrow(/pixels/);
    expect(store.records.size).toBe(0);
  });
});
