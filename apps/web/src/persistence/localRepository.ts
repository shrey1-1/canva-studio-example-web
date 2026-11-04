import { DocumentError, migrateDocument, type DesignDocument, type DocumentId, type DocumentMeta } from '@canvas-studio/core';
import { toMeta, type DocumentRepository } from './repository';

const INDEX_KEY = 'canvas-studio:docs';
const docKey = (id: DocumentId) => `canvas-studio:doc:${id}`;

export class StorageQuotaError extends Error {
  override name = 'StorageQuotaError';
}

/** The stored file exists but cannot be opened (damaged, or from a newer app version). */
export class DocumentLoadError extends Error {
  override name = 'DocumentLoadError';
}

function readIndex(storage: Storage): DocumentMeta[] {
  try {
    const raw = storage.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as DocumentMeta[]) : [];
  } catch {
    return [];
  }
}

/** Browser storage implementation used until the backend exists (Phase 6). */
export class LocalDocumentRepository implements DocumentRepository {
  constructor(private readonly storage: Storage = localStorage) {}

  async list(): Promise<DocumentMeta[]> {
    return readIndex(this.storage).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Returns null when no such file exists; throws `DocumentLoadError` when it cannot be read. */
  async load(id: DocumentId): Promise<DesignDocument | null> {
    const raw = this.storage.getItem(docKey(id));
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new DocumentLoadError('The saved data is not valid JSON.');
    }
    try {
      return migrateDocument(parsed);
    } catch (error) {
      throw new DocumentLoadError(error instanceof DocumentError ? error.message : 'The saved data could not be read.');
    }
  }

  /** Saves the document; `updatedAt` is stamped here (on the stored copy), not by edits. */
  async save(doc: DesignDocument, savedAt: Date = new Date()): Promise<void> {
    const stored: DesignDocument = { ...doc, updatedAt: savedAt.toISOString() };
    try {
      this.storage.setItem(docKey(doc.id), JSON.stringify(stored));
      const index = readIndex(this.storage).filter((m) => m.id !== doc.id);
      index.push(toMeta(stored));
      this.storage.setItem(INDEX_KEY, JSON.stringify(index));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new StorageQuotaError('Browser storage is full. Delete unused files to keep saving.');
      }
      throw error;
    }
  }

  async delete(id: DocumentId): Promise<void> {
    this.storage.removeItem(docKey(id));
    this.storage.setItem(INDEX_KEY, JSON.stringify(readIndex(this.storage).filter((m) => m.id !== id)));
  }
}

export const documentRepository: DocumentRepository = new LocalDocumentRepository();
