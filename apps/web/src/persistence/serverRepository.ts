import { create } from 'zustand';
import { DocumentError, migrateDocument, type DesignDocument, type DocumentId, type DocumentMeta } from '@canvas-studio/core';
import { api, ApiError } from './api';
import { setAssetProject } from './assetStore';
import { DocumentLoadError } from './localRepository';
import type { DocumentRepository } from './repository';

export type Role = 'owner' | 'editor' | 'viewer';

export interface FileMeta {
  id: string;
  name: string;
  projectId: string;
  folderId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  pageCount: number;
  projectName?: string;
  role?: Role;
}

/** Server-side facts about the open file: its project, the user's role and the stored revision. */
interface OpenFileState {
  id: string | null;
  projectId: string | null;
  role: Role | null;
  revision: number;
}

export const useOpenFile = create<OpenFileState>()(() => ({ id: null, projectId: null, role: null, revision: 0 }));

/** Someone else saved the file since it was loaded. */
export class SaveConflictError extends Error {
  override name = 'SaveConflictError';
}

/** Documents stored on the server, with optimistic concurrency (revision numbers). */
export class ServerDocumentRepository implements DocumentRepository {
  async list(): Promise<DocumentMeta[]> {
    const { files } = await api<{ files: FileMeta[] }>('GET', '/files/recent');
    return files.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt, updatedAt: f.updatedAt, pageCount: f.pageCount }));
  }

  async load(id: DocumentId): Promise<DesignDocument | null> {
    let file: FileMeta & { document: unknown };
    try {
      ({ file } = await api<{ file: FileMeta & { document: unknown } }>('GET', `/files/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
      throw e;
    }
    let doc: DesignDocument;
    try {
      doc = migrateDocument(file.document);
    } catch (error) {
      throw new DocumentLoadError(error instanceof DocumentError ? error.message : 'The saved data could not be read.');
    }
    useOpenFile.setState({ id, projectId: file.projectId, role: file.role ?? 'viewer', revision: file.revision });
    setAssetProject(file.projectId);
    return doc;
  }

  async save(doc: DesignDocument): Promise<void> {
    const open = useOpenFile.getState();
    if (open.id !== doc.id) throw new Error('This file is not open.');
    if (open.role === 'viewer') return;
    try {
      const { revision } = await api<{ revision: number }>('PUT', `/files/${doc.id}`, { document: doc as unknown as Record<string, unknown>, baseRevision: open.revision });
      useOpenFile.setState({ revision });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        throw new SaveConflictError('Someone else saved a newer version of this file. Reload to see it (your latest changes are not saved).');
      }
      throw e;
    }
  }

  async delete(id: DocumentId): Promise<void> {
    await api('DELETE', `/files/${id}`);
  }
}

/** Puts a version back; returns the restored document (the server keeps the previous state as a version). */
export async function restoreVersion(fileId: string, versionId: string): Promise<DesignDocument> {
  const { document, revision } = await api<{ document: unknown; revision: number }>('POST', `/files/${fileId}/versions/${versionId}/restore`);
  useOpenFile.setState({ revision });
  return migrateDocument(document);
}

export const documentRepository: DocumentRepository = new ServerDocumentRepository();
