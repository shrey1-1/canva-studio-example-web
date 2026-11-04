import type { DesignDocument, DocumentId, DocumentMeta } from '@canvas-studio/core';

/**
 * Storage boundary for documents. Phase 1 ships a browser (localStorage) implementation;
 * Phase 6 adds an HTTP implementation backed by the server database without changing callers.
 */
export interface DocumentRepository {
  list(): Promise<DocumentMeta[]>;
  load(id: DocumentId): Promise<DesignDocument | null>;
  save(doc: DesignDocument): Promise<void>;
  delete(id: DocumentId): Promise<void>;
}

export function toMeta(doc: DesignDocument): DocumentMeta {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pageCount: doc.pages.length,
  };
}
