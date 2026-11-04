/** Writing documents and versions; shared by HTTP saves and live collaboration rooms. */
import { randomUUID } from 'node:crypto';
import type { DesignDocument } from '@canvas-studio/core';
import { HttpError } from './access';
import type { Queryable } from './db';

/** An automatic version is kept at most this often while someone edits. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60_000;
export const MAX_AUTO_VERSIONS = 50;

export async function snapshot(db: Queryable, fileId: string, userId: string, label: string | null, auto: boolean) {
  await db.query(
    `insert into file_versions (id, file_id, label, auto, document, revision, created_by)
     select $1, id, $3, $4, document, revision, $5 from files where id = $2`,
    [randomUUID(), fileId, label, auto, userId],
  );
  if (auto) {
    await db.query(
      `delete from file_versions where id in (
         select id from file_versions where file_id = $1 and auto order by created_at desc offset $2)`,
      [fileId, MAX_AUTO_VERSIONS],
    );
  }
}

/**
 * Stores a document (run inside a transaction). With `baseRevision`, the write only happens if
 * the stored revision still matches (409 otherwise). Returns the new revision.
 */
export async function persistDocument(tx: Queryable, fileId: string, userId: string, doc: DesignDocument, baseRevision?: number): Promise<number> {
  const stored = { ...doc, updatedAt: new Date().toISOString() };
  const updated = await tx.query<{ revision: number; project_id: string }>(
    `update files set document = $2, name = $3, revision = revision + 1, updated_at = now(), updated_by = $4
     where id = $1 and ($5::int is null or revision = $5) returning revision, project_id`,
    [fileId, JSON.stringify(stored), stored.name, userId, baseRevision ?? null],
  );
  const row = updated.rows[0];
  if (!row) {
    const current = await tx.query<{ revision: number }>('select revision from files where id = $1', [fileId]);
    if (!current.rows[0]) throw new HttpError(404, 'File not found.');
    throw new HttpError(409, 'This file was changed by someone else.', { revision: current.rows[0].revision });
  }
  await tx.query('update projects set updated_at = now() where id = $1', [row.project_id]);
  const last = await tx.query<{ created_at: Date }>('select created_at from file_versions where file_id = $1 and auto order by created_at desc limit 1', [fileId]);
  const lastAt = last.rows[0] ? new Date(last.rows[0].created_at).getTime() : 0;
  if (Date.now() - lastAt >= AUTO_VERSION_INTERVAL_MS) await snapshot(tx, fileId, userId, null, true);
  return row.revision;
}
