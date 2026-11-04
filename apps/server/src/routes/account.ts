import type { FastifyPluginAsync } from 'fastify';
import { SESSION_COOKIE, timingDummy, verifyPassword } from '../auth';
import { HttpError, requireUser } from '../access';
import type { Db, Queryable } from '../db';

/** Personal data rights: download everything about you, and delete your account. */
export const accountRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/api/account/export', async (req, reply) => {
    const user = requireUser(req.user);
    if (user.token) throw new HttpError(403, 'Access tokens cannot export accounts.');
    const q = (sql: string) => db.query(sql, [user.id]).then((r) => r.rows);
    const [profile, memberships, ownedFiles, comments, tokens] = await Promise.all([
      q('select id, email, name, created_at as "createdAt" from users where id = $1'),
      q('select p.id, p.name, m.role from project_members m join projects p on p.id = m.project_id where m.user_id = $1'),
      q(`select f.id, f.name, p.name as project, f.document, f.updated_at as "updatedAt" from files f join projects p on p.id = f.project_id
         join project_members m on m.project_id = p.id and m.user_id = $1 and m.role = 'owner'`),
      q('select id, file_id as "fileId", body, created_at as "createdAt" from comments where user_id = $1'),
      q('select id, name, scopes, created_at as "createdAt", last_used_at as "lastUsedAt", revoked_at as "revokedAt" from api_tokens where user_id = $1'),
    ]);
    return reply
      .header('Content-Disposition', 'attachment; filename="canvas-studio-account.json"')
      .send({ exportedAt: new Date().toISOString(), profile: profile[0], projects: memberships, files: ownedFiles, comments, accessTokens: tokens });
  });

  /**
   * Deletes the account. Projects you own alone are deleted with their files; projects with other
   * owners stay with them. Refused while you are the only owner of a project others use.
   */
  app.delete<{ Body: { password: string } }>(
    '/api/account',
    { schema: { body: { type: 'object', required: ['password'], additionalProperties: false, properties: { password: { type: 'string', maxLength: 200 } } } } },
    async (req, reply) => {
      const user = requireUser(req.user);
      if (user.token) throw new HttpError(403, 'Access tokens cannot delete accounts.');
      const { rows } = await db.query<{ password_hash: string }>('select password_hash from users where id = $1', [user.id]);
      if (!(await verifyPassword(req.body.password, rows[0]?.password_hash ?? (await timingDummy())))) throw new HttpError(401, 'Password is incorrect.');
      await db.transaction(async (tx: Queryable) => {
        const blocked = await tx.query<{ name: string }>(
          `select p.name from projects p join project_members me on me.project_id = p.id and me.user_id = $1 and me.role = 'owner'
           where not exists (select 1 from project_members o where o.project_id = p.id and o.role = 'owner' and o.user_id <> $1)
             and exists (select 1 from project_members o where o.project_id = p.id and o.user_id <> $1)`,
          [user.id],
        );
        if (blocked.rows.length) {
          throw new HttpError(409, `Make someone else an owner of ${blocked.rows.map((r) => `“${r.name}”`).join(', ')} first, or remove its other members.`);
        }
        // Projects shared with other owners stay; hand the creator link to one of them.
        await tx.query(
          `update projects p set owner_id = (select o.user_id from project_members o where o.project_id = p.id and o.role = 'owner' and o.user_id <> $1 limit 1)
           where p.owner_id = $1 and exists (select 1 from project_members o where o.project_id = p.id and o.role = 'owner' and o.user_id <> $1)`,
          [user.id],
        );
        // Projects only this user belongs to go away with the account (cascade: files, versions, images, comments).
        await tx.query(
          `delete from projects p where exists (select 1 from project_members m where m.project_id = p.id and m.user_id = $1)
             and not exists (select 1 from project_members o where o.project_id = p.id and o.user_id <> $1)`,
          [user.id],
        );
        await tx.query('delete from users where id = $1', [user.id]);
      });
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    },
  );
};

/** Deletes images no file or version in their project refers to (after a grace period for uploads in progress). */
export async function collectUnusedAssets(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `delete from assets a where a.created_at < now() - interval '1 hour'
       and not exists (select 1 from files f where f.project_id = a.project_id and strpos(f.document::text, a.id) > 0)
       and not exists (select 1 from file_versions v join files f on f.id = v.file_id
                       where f.project_id = a.project_id and strpos(v.document::text, a.id) > 0)
     returning a.id`,
  );
  return rows.length;
}
