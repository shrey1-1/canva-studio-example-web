import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError, requireFolder, requireProject, requireUser, ROLES, type Role } from '../access';
import type { Db, Queryable } from '../db';

const idParam = { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } as const;
const name = { type: 'string', minLength: 1, maxLength: 120 } as const;
const nameBody = { type: 'object', required: ['name'], additionalProperties: false, properties: { name } } as const;

/** File metadata, as listed in the file browser. */
export const FILE_META_SQL = `f.id, f.name, f.project_id as "projectId", f.folder_id as "folderId", f.revision,
  f.created_at as "createdAt", f.updated_at as "updatedAt", jsonb_array_length(f.document->'pages') as "pageCount"`;

async function ownerCount(db: Queryable, projectId: string) {
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from project_members where project_id = $1 and role = 'owner'`, [projectId]);
  return rows[0]!.n;
}

export const projectRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // ----- Projects -----
  app.get('/api/projects', async (req) => {
    const user = requireUser(req.user);
    const { rows } = await db.query(
      `select p.id, p.name, m.role, p.updated_at as "updatedAt",
         (select count(*)::int from files f where f.project_id = p.id) as "fileCount"
       from projects p join project_members m on m.project_id = p.id and m.user_id = $1
       order by p.created_at`,
      [user.id],
    );
    return { projects: rows };
  });

  app.post<{ Body: { name: string } }>('/api/projects', { schema: { body: nameBody } }, async (req, reply) => {
    const user = requireUser(req.user);
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query('insert into projects (id, name, owner_id) values ($1, $2, $3)', [id, req.body.name.trim(), user.id]);
      await tx.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`, [id, user.id]);
    });
    return reply.status(201).send({ project: { id, name: req.body.name.trim(), role: 'owner', fileCount: 0 } });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', { schema: { params: idParam } }, async (req) => {
    const user = requireUser(req.user);
    const role = await requireProject(db, user, req.params.id, 'viewer');
    const [project, members, folders, files] = await Promise.all([
      db.query('select id, name, updated_at as "updatedAt" from projects where id = $1', [req.params.id]),
      db.query('select u.id, u.email, u.name, m.role from project_members m join users u on u.id = m.user_id where m.project_id = $1 order by u.name', [req.params.id]),
      db.query('select id, name, parent_id as "parentId" from folders where project_id = $1 order by name', [req.params.id]),
      db.query(`select ${FILE_META_SQL} from files f where f.project_id = $1 order by f.updated_at desc`, [req.params.id]),
    ]);
    return { project: { ...project.rows[0], role }, members: members.rows, folders: folders.rows, files: files.rows };
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/projects/:id', { schema: { params: idParam, body: nameBody } }, async (req) => {
    const user = requireUser(req.user);
    await requireProject(db, user, req.params.id, 'owner');
    await db.query('update projects set name = $2, updated_at = now() where id = $1', [req.params.id, req.body.name.trim()]);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', { schema: { params: idParam } }, async (req, reply) => {
    const user = requireUser(req.user);
    await requireProject(db, user, req.params.id, 'owner');
    await db.query('delete from projects where id = $1', [req.params.id]);
    return reply.status(204).send();
  });

  // ----- Members -----
  const memberParams = {
    type: 'object',
    required: ['id', 'userId'],
    properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' } },
  } as const;
  const roleSchema = { type: 'string', enum: ROLES } as const;

  app.post<{ Params: { id: string }; Body: { email: string; role: Role } }>(
    '/api/projects/:id/members',
    {
      schema: {
        params: idParam,
        body: { type: 'object', required: ['email', 'role'], additionalProperties: false, properties: { email: { type: 'string', maxLength: 254 }, role: roleSchema } },
      },
    },
    async (req, reply) => {
      const user = requireUser(req.user);
      await requireProject(db, user, req.params.id, 'owner');
      const { rows } = await db.query<{ id: string; name: string; email: string }>('select id, name, email from users where email = $1', [req.body.email.trim().toLowerCase()]);
      const invitee = rows[0];
      if (!invitee) throw new HttpError(404, 'No account uses this email. Ask them to sign up first.');
      await db.query(
        `insert into project_members (project_id, user_id, role) values ($1, $2, $3)
         on conflict (project_id, user_id) do update set role = excluded.role`,
        [req.params.id, invitee.id, req.body.role],
      );
      return reply.status(201).send({ member: { ...invitee, role: req.body.role } });
    },
  );

  app.patch<{ Params: { id: string; userId: string }; Body: { role: Role } }>(
    '/api/projects/:id/members/:userId',
    { schema: { params: memberParams, body: { type: 'object', required: ['role'], additionalProperties: false, properties: { role: roleSchema } } } },
    async (req) => {
      const user = requireUser(req.user);
      await requireProject(db, user, req.params.id, 'owner');
      await db.transaction(async (tx) => {
        const { rows } = await tx.query<{ role: Role }>('select role from project_members where project_id = $1 and user_id = $2', [req.params.id, req.params.userId]);
        if (!rows[0]) throw new HttpError(404, 'Member not found.');
        if (rows[0].role === 'owner' && req.body.role !== 'owner' && (await ownerCount(tx, req.params.id)) <= 1) {
          throw new HttpError(409, 'A project needs at least one owner.');
        }
        await tx.query('update project_members set role = $3 where project_id = $1 and user_id = $2', [req.params.id, req.params.userId, req.body.role]);
      });
      return { ok: true };
    },
  );

  /** Owners remove anyone; any member may remove themselves (leave). */
  app.delete<{ Params: { id: string; userId: string } }>('/api/projects/:id/members/:userId', { schema: { params: memberParams } }, async (req, reply) => {
    const user = requireUser(req.user);
    await requireProject(db, user, req.params.id, req.params.userId === user.id ? 'viewer' : 'owner');
    await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ role: Role }>('select role from project_members where project_id = $1 and user_id = $2', [req.params.id, req.params.userId]);
      if (!rows[0]) throw new HttpError(404, 'Member not found.');
      if (rows[0].role === 'owner' && (await ownerCount(tx, req.params.id)) <= 1) throw new HttpError(409, 'A project needs at least one owner.');
      await tx.query('delete from project_members where project_id = $1 and user_id = $2', [req.params.id, req.params.userId]);
    });
    return reply.status(204).send();
  });

  // ----- Folders -----
  app.post<{ Params: { id: string }; Body: { name: string; parentId?: string | null } }>(
    '/api/projects/:id/folders',
    {
      schema: {
        params: idParam,
        body: { type: 'object', required: ['name'], additionalProperties: false, properties: { name, parentId: { type: ['string', 'null'], format: 'uuid' } } },
      },
    },
    async (req, reply) => {
      const user = requireUser(req.user);
      await requireProject(db, user, req.params.id, 'editor');
      const parentId = req.body.parentId ?? null;
      if (parentId && (await requireFolder(db, user, parentId, 'editor')).projectId !== req.params.id) throw new HttpError(400, 'Parent folder is in another project.');
      const id = randomUUID();
      await db.query('insert into folders (id, project_id, parent_id, name) values ($1, $2, $3, $4)', [id, req.params.id, parentId, req.body.name.trim()]);
      return reply.status(201).send({ folder: { id, name: req.body.name.trim(), parentId } });
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; parentId?: string | null } }>(
    '/api/folders/:id',
    {
      schema: {
        params: idParam,
        body: { type: 'object', additionalProperties: false, properties: { name, parentId: { type: ['string', 'null'], format: 'uuid' } } },
      },
    },
    async (req) => {
      const user = requireUser(req.user);
      const folder = await requireFolder(db, user, req.params.id, 'editor');
      if (req.body.parentId !== undefined) {
        const target = req.body.parentId;
        // Walk up from the new parent: it must be in the same project and not inside this folder.
        for (let cur = target, depth = 0; cur; depth++) {
          if (cur === req.params.id || depth > 100) throw new HttpError(400, 'A folder cannot be moved into itself.');
          const { rows } = await db.query<{ project_id: string; parent_id: string | null }>('select project_id, parent_id from folders where id = $1', [cur]);
          if (!rows[0] || rows[0].project_id !== folder.projectId) throw new HttpError(400, 'Target folder not found in this project.');
          cur = rows[0].parent_id;
        }
        await db.query('update folders set parent_id = $2 where id = $1', [req.params.id, target]);
      }
      if (req.body.name !== undefined) await db.query('update folders set name = $2 where id = $1', [req.params.id, req.body.name.trim()]);
      return { ok: true };
    },
  );

  /** Deletes a folder and its sub-folders; their files move to the project's top level. */
  app.delete<{ Params: { id: string } }>('/api/folders/:id', { schema: { params: idParam } }, async (req, reply) => {
    const user = requireUser(req.user);
    await requireFolder(db, user, req.params.id, 'editor');
    await db.query('delete from folders where id = $1', [req.params.id]);
    return reply.status(204).send();
  });
};
