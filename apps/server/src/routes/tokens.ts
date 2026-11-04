import type { FastifyPluginAsync } from 'fastify';
import { createApiToken } from '../auth';
import { HttpError, requireProject, requireUser } from '../access';
import type { Db } from '../db';

/** Personal access tokens for AI agents (MCP). Only browser sessions can manage them. */
export const tokenRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/api/tokens', async (req) => {
    const user = requireUser(req.user);
    const { rows } = await db.query(
      `select t.id, t.name, t.scopes, t.project_id as "projectId", p.name as "projectName",
         t.last_used_at as "lastUsedAt", t.created_at as "createdAt"
       from api_tokens t left join projects p on p.id = t.project_id
       where t.user_id = $1 and t.revoked_at is null order by t.created_at desc`,
      [user.id],
    );
    return { tokens: rows };
  });

  app.post<{ Body: { name: string; scopes: 'read' | 'write'; projectId?: string | null } }>(
    '/api/tokens',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'scopes'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            scopes: { type: 'string', enum: ['read', 'write'] },
            projectId: { type: ['string', 'null'], format: 'uuid' },
          },
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req.user);
      const projectId = req.body.projectId ?? null;
      if (projectId) await requireProject(db, user, projectId, 'viewer');
      const { rows } = await db.query<{ n: number }>('select count(*)::int as n from api_tokens where user_id = $1 and revoked_at is null', [user.id]);
      if (rows[0]!.n >= 20) throw new HttpError(409, 'You have 20 active tokens. Revoke one first.');
      const { id, secret } = await createApiToken(db, user.id, req.body.name.trim(), req.body.scopes, projectId);
      return reply.status(201).send({ token: { id, name: req.body.name.trim(), scopes: req.body.scopes, projectId }, secret });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/tokens/:id',
    { schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } },
    async (req, reply) => {
      const user = requireUser(req.user);
      const { rows } = await db.query('update api_tokens set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null returning id', [req.params.id, user.id]);
      if (!rows.length) throw new HttpError(404, 'Token not found.');
      return reply.status(204).send();
    },
  );
};
