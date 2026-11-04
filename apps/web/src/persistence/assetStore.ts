/**
 * Binary asset storage (images). Documents only hold an `assetId`; the bytes live here.
 * Phase 2 keeps them in this browser's IndexedDB (localStorage is far too small for images).
 * Phase 6 stores them on the server (ServerAssetStore); the IndexedDB store remains for importing
 * files made before accounts existed.
 *
 * Asset ids are SHA-256 hashes of the content, so importing the same image twice stores it once.
 */

import { api, apiBlob } from './api';

export interface AssetRecord {
  id: string;
  mime: ImageMime;
  size: number;
  width: number;
  height: number;
  createdAt: string;
  blob: Blob;
}

export interface AssetStore {
  put(record: AssetRecord): Promise<void>;
  get(id: string): Promise<AssetRecord | undefined>;
}

const DB_NAME = 'canvas-studio';
const STORE = 'assets';

export class IndexedDbAssetStore implements AssetStore {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open image storage'));
    });
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('Image storage failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Image storage was aborted (storage may be full)'));
    });
  }

  async put(record: AssetRecord): Promise<void> {
    await this.run('readwrite', (s) => s.put(record));
  }

  async get(id: string): Promise<AssetRecord | undefined> {
    return (await this.run('readonly', (s) => s.get(id))) as AssetRecord | undefined;
  }
}

export class MemoryAssetStore implements AssetStore {
  readonly records = new Map<string, AssetRecord>();
  async put(record: AssetRecord) {
    this.records.set(record.id, record);
  }
  async get(id: string) {
    return this.records.get(id);
  }
}

let assetProject: string | null = null;
/** New images are uploaded into the project of the file that is open. */
export function setAssetProject(projectId: string | null) {
  assetProject = projectId;
}

/** Images stored on the server (Phase 6), shared by everyone in the project. */
export class ServerAssetStore implements AssetStore {
  async put(record: AssetRecord): Promise<void> {
    if (!assetProject) throw new ImageImportError('Open a file before adding images.');
    await api('PUT', `/projects/${assetProject}/assets/${record.id}`, record.blob, {
      query: { width: record.width, height: record.height },
      contentType: record.mime,
    });
  }

  async get(id: string): Promise<AssetRecord | undefined> {
    const res = await apiBlob(`/assets/${id}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Image could not be loaded (${res.status})`);
    const blob = await res.blob();
    return {
      id,
      mime: (res.headers.get('content-type') ?? blob.type) as ImageMime,
      size: blob.size,
      width: Number(res.headers.get('x-image-width')) || 1,
      height: Number(res.headers.get('x-image-height')) || 1,
      createdAt: res.headers.get('x-created-at') ?? new Date().toISOString(),
      blob,
    };
  }
}

/** Images from before Phase 6, kept in this browser (read when importing local files). */
export const localAssetStore: AssetStore = typeof indexedDB === 'undefined' ? new MemoryAssetStore() : new IndexedDbAssetStore();

export const assetStore: AssetStore = import.meta.env.MODE === 'test' ? new MemoryAssetStore() : new ServerAssetStore();

// ---------------------------------------------------------------------------
// Importing images
// ---------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16_384;
export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export class ImageImportError extends Error {
  override name = 'ImageImportError';
}

/**
 * Detects the format from the file's first bytes rather than trusting its name/type.
 * SVG is deliberately not accepted: it can carry scripts and external references.
 */
export function sniffImageType(bytes: Uint8Array): ImageMime | null {
  const at = (i: number) => bytes[i];
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type ImageDecoder = (blob: Blob) => Promise<{ width: number; height: number }>;

const browserDecoder: ImageDecoder = async (blob) => {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
};

export interface ImportedImage {
  assetId: string;
  width: number;
  height: number;
  name: string;
}

/** Validates, decodes and stores an image file. Throws `ImageImportError` with a readable reason. */
export async function importImage(
  file: Blob & { name?: string },
  store: AssetStore = assetStore,
  decode: ImageDecoder = browserDecoder,
): Promise<ImportedImage> {
  const label = file.name || 'Image';
  if (file.size === 0) throw new ImageImportError(`${label} is empty.`);
  if (file.size > MAX_IMAGE_BYTES) throw new ImageImportError(`${label} is larger than 20 MB.`);
  const buffer = await file.arrayBuffer();
  const mime = sniffImageType(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)));
  if (!mime) throw new ImageImportError(`${label} is not a PNG, JPEG, GIF or WebP image.`);
  const blob = new Blob([buffer], { type: mime });
  let size: { width: number; height: number };
  try {
    size = await decode(blob);
  } catch {
    throw new ImageImportError(`${label} could not be decoded. The file may be damaged.`);
  }
  if (size.width < 1 || size.height < 1 || size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) {
    throw new ImageImportError(`${label} must be between 1 and ${MAX_IMAGE_SIDE} pixels on each side.`);
  }
  const id = await sha256Hex(buffer);
  if (!(await store.get(id))) {
    await store.put({ id, mime, size: buffer.byteLength, ...size, createdAt: new Date().toISOString(), blob });
  }
  forgetFailedImage(id);
  const name = label.replace(/\.[a-z0-9]+$/i, '') || 'Image';
  return { assetId: id, ...size, name };
}

// ---------------------------------------------------------------------------
// Loading images for rendering
// ---------------------------------------------------------------------------

type Entry =
  | { status: 'loading'; promise: Promise<void> }
  | { status: 'ready'; image: HTMLImageElement }
  | { status: 'missing' }
  | { status: 'error' };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Bumped whenever any image finishes loading (lets cached/blurred layers redraw). */
let imageVersion = 0;
export const getImageVersion = () => imageVersion;

/** A re-imported image replaces an earlier "missing" result. */
function forgetFailedImage(id: string) {
  const entry = cache.get(id);
  if (entry && (entry.status === 'missing' || entry.status === 'error')) {
    cache.delete(id);
    imageVersion++;
    listeners.forEach((l) => l());
  }
}

export function subscribeImages(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Returns the current load state of an asset, starting the load on first request. */
export function getImageEntry(assetId: string, store: AssetStore = assetStore): Entry {
  const existing = cache.get(assetId);
  if (existing) return existing;
  const promise = (async () => {
    let next: Entry;
    try {
      const record = await store.get(assetId);
      if (!record) {
        next = { status: 'missing' };
      } else {
        const image = new Image();
        image.src = URL.createObjectURL(record.blob);
        await image.decode();
        next = { status: 'ready', image };
      }
    } catch {
      next = { status: 'error' };
    }
    cache.set(assetId, next);
    imageVersion++;
    listeners.forEach((l) => l());
  })();
  const entry: Entry = { status: 'loading', promise };
  cache.set(assetId, entry);
  return entry;
}
