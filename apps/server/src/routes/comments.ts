import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError, requireFile, requireUser } from '../access';
import type { CollabHub } from '../collab';
import type { Db } from '../db';

const uuid = { type: 'string', format: 'uuid' } as const;
const body = { type: 'string', minLength: 1, maxLength: 5000 } as const;

/**
 * Comments on a file. Anyone who can open the file (viewers too) can comment and reply.
 * Authors edit their own text; authors and editors can resolve; authors and owners can delete.
 */
export const commentRoutes: FastifyPluginAsync<{ db: Db; hub?: CollabHub }> = async (app, { db, hub }) => {
  const SELECT = `select c.id, c.parent_id as "parentId", c.user_id as "userId", u.name as "author", c.page_id as "pageId",
    c.node_id as "nodeId", c.x, c.y, c.body, c.resolved, c.created_at as "createdAt", c.updated_at as "updatedAt"
    from comments c left join users u on u.id = c.user_id`;

  async function commentFile(id: string) {
    const { rows } = await db.query<{ file_id: string; user_id: string | null }>('select file_id, user_id from comments where id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'Comment not found.');
    return rows[0];
  }

  app.get<{ Params: { id: string } }>('/api/files/:id/comments', { schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (req) => {
    const user = requireUser(req.user);
    await requireFile(db, user, req.params.id, 'viewer');
    const { rows } = await db.query(`${SELECT} where c.file_id = $1 order by c.created_at`, [req.params.id]);
    return { comments: rows };
  });

  app.post<{ Params: { id: string }; Body: { body: string; parentId?: string; pageId?: string; nodeId?: string; x?: number; y?: number } }>(
    '/api/files/:id/comments',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: uuid } },
        body: {
          type: 'object',
          required: ['body'],
          additionalProperties: false,
          properties: {
            body,
            parentId: uuid,
            pageId: { type: 'string', maxLength: 64 },
            nodeId: { type: 'string', maxLength: 64 },
            x: { type: 'number', minimum: -1e7, maximum: 1e7 },
            y: { type: 'number', minimum: -1e7, maximum: 1e7 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req.user);
      await requireFile(db, user, req.params.id, 'viewer');
      const b = req.body;
      if (b.parentId) {
        const parent = await commentFile(b.parentId);
        if (parent.file_id !== req.params.id) throw new HttpError(400, 'Reply to a comment on this file.');
      } else if (b.x === undefined || b.y === undefined || !b.pageId) {
        throw new HttpError(400, 'A new comment needs a page and a position.');
      }
      const id = randomUUID();
      await db.query(
        'insert into comments (id, file_id, parent_id, user_id, page_id, node_id, x, y, body) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [id, req.params.id, b.parentId ?? null, user.id, b.parentId ? null : b.pageId, b.parentId ? null : (b.nodeId ?? null), b.parentId ? null : b.x, b.parentId ? null : b.y, b.body.trim()],
      );
      hub?.notify(req.params.id, { t: 'comments' });
      const { rows } = await db.query(`${SELECT} where c.id = $1`, [id]);
      return reply.status(201).send({ comment: rows[0] });
    },
  );

  app.patch<{ Params: { id: string }; Body: { body?: string; resolved?: boolean } }>(
    '/api/comments/:id',
    {
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: uuid } },
        body: { type: 'object', additionalProperties: false, properties: { body, resolved: { type: 'boolean' } } },
      },
    },
    async (req) => {
      const user = requireUser(req.user);
      const c = await commentFile(req.params.id);
      const { role } = await requireFile(db, user, c.file_id, 'viewer');
      const isAuthor = c.user_id === user.id;
      if (req.body.body !== undefined && !isAuthor) throw new HttpError(403, 'Only the author can edit a comment.');
      if (req.body.resolved !== undefined && !isAuthor && role === 'viewer') throw new HttpError(403, 'Viewers can only resolve their own comments.');
      await db.query('update comments set body = coalesce($2, body), resolved = coalesce($3, resolved), updated_at = now() where id = $1', [
        req.params.id,
        req.body.body?.trim() ?? null,
        req.body.resolved ?? null,
      ]);
      hub?.notify(c.file_id, { t: 'comments' });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/comments/:id', { schema: { params: { type: 'object', required: ['id'], properties: { id: uuid } } } }, async (req, reply) => {
    const user = requireUser(req.user);
    const c = await commentFile(req.params.id);
    const { role } = await requireFile(db, user, c.file_id, 'viewer');
    if (c.user_id !== user.id && role !== 'owner') throw new HttpError(403, 'Only the author or a project owner can delete a comment.');
    await db.query('delete from comments where id = $1', [req.params.id]);
    hub?.notify(c.file_id, { t: 'comments' });
    return reply.status(204).send();
  });
};
