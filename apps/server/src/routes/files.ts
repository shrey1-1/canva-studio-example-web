import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { createDocument, DocumentError, migrateDocument, type DesignDocument } from '@canvas-studio/core';
import { HttpError, requireFile, requireProject, requireUser } from '../access';
import type { Db, Queryable } from '../db';
import { FILE_META_SQL } from './projects';
import { persistDocument, snapshot } from '../persist';
import type { CollabHub } from '../collab';

const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;
const DOC_LIMIT = 25 * 1024 * 1024;
/** Untrusted document JSON -> a valid current-version document, or a 400. */
function validDocument(raw: unknown): DesignDocument {
  try {
    return migrateDocument(raw);
  } catch (error) {
    throw new HttpError(400, `The file is not valid: ${error instanceof DocumentError ? error.message : 'unreadable'}`);
  }
}

const assetIdsOf = (doc: DesignDocument) => [...new Set(Object.values(doc.nodes).flatMap((n) => (n.type === 'image' ? [n.assetId] : [])))];

async function folderInProject(db: Queryable, folderId: string | null | undefined, projectId: string) {
  if (!folderId) return;
  const { rows } = await db.query('select 1 from folders where id = $1 and project_id = $2', [folderId, projectId]);
  if (!rows.length) throw new HttpError(400, 'Folder not found in this project.');
}

export const fileRoutes: FastifyPluginAsync<{ db: Db; hub?: CollabHub }> = async (app, { db, hub }) => {
  /** Recently edited files across all of the user's projects. */
  app.get('/api/files/recent', async (req) => {
    const user = requireUser(req.user);
    const { rows } = await db.query(
      `select ${FILE_META_SQL}, p.name as "projectName", m.role from files f
       join project_members m on m.project_id = f.project_id and m.user_id = $1
       join projects p on p.id = f.project_id
       where $2::uuid is null or f.project_id = $2
       order by f.updated_at desc limit 50`,
      [user.id, user.token?.projectId ?? null],
    );
    return { files: rows };
  });

  app.post<{ Params: { id: string }; Body: { name?: string; folderId?: string | null; document?: unknown } }>(
    '/api/projects/:id/files',
    {
      bodyLimit: DOC_LIMIT,
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, folderId: { type: ['string', 'null'], format: 'uuid' }, document: { type: 'object' } },
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req.user);
      await requireProject(db, user, req.params.id, 'editor');
      await folderInProject(db, req.body.folderId, req.params.id);
      const doc = req.body.document ? validDocument(req.body.document) : createDocument(req.body.name ?? 'Untitled');
      if (req.body.name) doc.name = req.body.name;
      // Imported files keep their id unless it is taken.
      const taken = await db.query('select 1 from files where id = $1', [doc.id]);
      if (taken.rows.length) doc.id = randomUUID();
      await db.query(
        `insert into files (id, project_id, folder_id, name, document, updated_by) values ($1, $2, $3, $4, $5, $6)`,
        [doc.id, req.params.id, req.body.folderId ?? null, doc.name, JSON.stringify(doc), user.id],
      );
      await db.query('update projects set updated_at = now() where id = $1', [req.params.id]);
      return reply.status(201).send({ file: { id: doc.id, name: doc.name, projectId: req.params.id, folderId: req.body.folderId ?? null, revision: 1 } });
    },
  );

  app.get<{ Params: { id: string } }>('/api/files/:id', { schema: { params: idParam } }, async (req) => {
    const user = requireUser(req.user);
    const { role } = await requireFile(db, user, req.params.id, 'viewer');
    const { rows } = await db.query(`select ${FILE_META_SQL}, f.document from files f where f.id = $1`, [req.params.id]);
    return { file: { ...rows[0], role } };
  });

  /** Saves a document. `baseRevision` must match the stored one, otherwise 409 (someone else saved first). */
  app.put<{ Params: { id: string }; Body: { document: unknown; baseRevision: number } }>(
    '/api/files/:id',
    {
      bodyLimit: DOC_LIMIT,
      schema: {
        params: idParam,
        body: { type: 'object', required: ['document', 'baseRevision'], additionalProperties: false, properties: { document: { type: 'object' }, baseRevision: { type: 'integer', minimum: 1 } } },
      },
    },
    async (req) => {
      const user = requireUser(req.user);
      await requireFile(db, user, req.params.id, 'editor');
      const doc = validDocument(req.body.document);
      if (doc.id !== req.params.id) throw new HttpError(400, 'Document id does not match the file.');
      // Live edits are saved first, so the revision check sees them.
      await hub?.flushFile(req.params.id);
      const revision = await db.transaction((tx) => persistDocument(tx, req.params.id, user.id, doc, req.body.baseRevision));
      hub?.replaced(req.params.id, doc, revision);
      return { revision, updatedAt: new Date().toISOString() };
    },
  );

  /** Rename and/or move a file (to another folder or project). */
  app.patch<{ Params: { id: string }; Body: { name?: string; folderId?: string | null; projectId?: string } }>(
    '/api/files/:id',
    {
      schema: {
        params: idParam,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 120 }, folderId: { type: ['string', 'null'], format: 'uuid' }, projectId: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (req) => {
      const user = requireUser(req.user);
      const { projectId } = await requireFile(db, user, req.params.id, 'editor');
      const target = req.body.projectId ?? projectId;
      if (target !== projectId) await requireProject(db, user, target, 'editor');
      if (req.body.folderId !== undefined) await folderInProject(db, req.body.folderId, target);
      if (req.body.name) await hub?.flushFile(req.params.id);
      await db.transaction(async (tx) => {
        if (target !== projectId) {
          // Images travel with the file.
          const { rows } = await tx.query<{ document: DesignDocument }>('select document from files where id = $1', [req.params.id]);
          await tx.query(
            `insert into assets (project_id, id, mime, size, width, height, data, created_at)
             select $1, id, mime, size, width, height, data, created_at from assets where project_id = $2 and id = any($3)
             on conflict do nothing`,
            [target, projectId, assetIdsOf(rows[0]!.document)],
          );
          await tx.query('update files set project_id = $2, folder_id = $3 where id = $1', [req.params.id, target, req.body.folderId ?? null]);
        } else if (req.body.folderId !== undefined) {
          await tx.query('update files set folder_id = $2 where id = $1', [req.params.id, req.body.folderId]);
        }
        if (req.body.name) {
          await tx.query(
            `update files set name = $2, document = jsonb_set(document, '{name}', to_jsonb($2::text)), revision = revision + 1, updated_at = now() where id = $1`,
            [req.params.id, req.body.name.trim()],
          );
        }
      });
      if (req.body.name) {
        const { rows } = await db.query<{ document: DesignDocument; revision: number }>('select document, revision from files where id = $1', [req.params.id]);
        if (rows[0]) hub?.replaced(req.params.id, rows[0].document, rows[0].revision);
      }
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/files/:id', { schema: { params: idParam } }, async (req, reply) => {
    const user = requireUser(req.user);
    await requireFile(db, user, req.params.id, 'editor');
    await db.query('delete from files where id = $1', [req.params.id]);
    hub?.close(req.params.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/files/:id/duplicate', { schema: { params: idParam } }, async (req, reply) => {
    const user = requireUser(req.user);
    const { projectId } = await requireFile(db, user, req.params.id, 'viewer');
    await requireProject(db, user, projectId, 'editor');
    const { rows } = await db.query<{ document: DesignDocument; folder_id: string | null }>('select document, folder_id from files where id = $1', [req.params.id]);
    const doc = { ...rows[0]!.document, id: randomUUID(), name: `${rows[0]!.document.name} (copy)` };
    await db.query('insert into files (id, project_id, folder_id, name, document, updated_by) values ($1, $2, $3, $4, $5, $6)', [
      doc.id, projectId, rows[0]!.folder_id, doc.name, JSON.stringify(doc), user.id,
    ]);
    return reply.status(201).send({ file: { id: doc.id, name: doc.name, projectId, folderId: rows[0]!.folder_id, revision: 1 } });
  });

  // ----- Version history -----
  app.get<{ Params: { id: string } }>('/api/files/:id/versions', { schema: { params: idParam } }, async (req) => {
    const user = requireUser(req.user);
    await requireFile(db, user, req.params.id, 'viewer');
    const { rows } = await db.query(
      `select v.id, v.label, v.auto, v.revision, v.created_at as "createdAt", u.name as "createdBy"
       from file_versions v left join users u on u.id = v.created_by where v.file_id = $1 order by v.created_at desc`,
      [req.params.id],
    );
    return { versions: rows };
  });

  app.post<{ Params: { id: string }; Body: { label: string } }>(
    '/api/files/:id/versions',
    { schema: { params: idParam, body: { type: 'object', required: ['label'], additionalProperties: false, properties: { label: { type: 'string', minLength: 1, maxLength: 120 } } } } },
    async (req, reply) => {
      const user = requireUser(req.user);
      await requireFile(db, user, req.params.id, 'editor');
      await hub?.flushFile(req.params.id);
      await snapshot(db, req.params.id, user.id, req.body.label.trim(), false);
      return reply.status(201).send({ ok: true });
    },
  );

  /** Restores a version: the current state is kept as a version first, so a restore can be undone. */
  app.post<{ Params: { id: string; versionId: string } }>(
    '/api/files/:id/versions/:versionId/restore',
    { schema: { params: { type: 'object', required: ['id', 'versionId'], properties: { id: { type: 'string', format: 'uuid' }, versionId: { type: 'string', format: 'uuid' } } } } },
    async (req) => {
      const user = requireUser(req.user);
      await requireFile(db, user, req.params.id, 'editor');
      await hub?.flushFile(req.params.id);
      const result = await db.transaction(async (tx) => {
        const { rows } = await tx.query<{ document: unknown }>('select document from file_versions where id = $1 and file_id = $2', [req.params.versionId, req.params.id]);
        if (!rows[0]) throw new HttpError(404, 'Version not found.');
        const doc = validDocument(rows[0].document);
        doc.id = req.params.id;
        doc.updatedAt = new Date().toISOString();
        await snapshot(tx, req.params.id, user.id, 'Before restore', false);
        const updated = await tx.query<{ revision: number }>(
          `update files set document = $2, name = $3, revision = revision + 1, updated_at = now(), updated_by = $4 where id = $1 returning revision`,
          [req.params.id, JSON.stringify(doc), doc.name, user.id],
        );
        return { document: doc, revision: updated.rows[0]!.revision };
      });
      hub?.replaced(req.params.id, result.document, result.revision);
      return result;
    },
  );

};
