import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { AttemptLimiter, createSession, destroySession, hashPassword, SESSION_COOKIE, SESSION_DAYS, timingDummy, verifyPassword } from '../auth';
import { HttpError, requireUser } from '../access';
import type { Db } from '../db';

const credentials = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: 8, maxLength: 200 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
  },
} as const;

type Credentials = { email: string; password: string; name?: string };

export const authRoutes: FastifyPluginAsync<{ db: Db; secureCookies: boolean; authAttempts: number }> = async (app, { db, secureCookies, authAttempts }) => {
  const limiter = new AttemptLimiter(authAttempts, 15 * 60_000);
  const cookieOptions = { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: SESSION_DAYS * 86_400 } as const;

  const startSession = async (reply: { setCookie: (n: string, v: string, o: typeof cookieOptions) => unknown }, userId: string) => {
    const { token } = await createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, cookieOptions);
  };

  app.post<{ Body: Credentials }>('/api/auth/signup', { schema: { body: { ...credentials, required: ['email', 'password', 'name'] } } }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    if (!limiter.take(`signup:${req.ip}`)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const userId = randomUUID();
    const hash = await hashPassword(req.body.password);
    const user = await db.transaction(async (tx) => {
      const exists = await tx.query('select 1 from users where email = $1', [email]);
      if (exists.rows.length) throw new HttpError(409, 'An account with this email already exists.');
      await tx.query('insert into users (id, email, name, password_hash) values ($1, $2, $3, $4)', [userId, email, req.body.name!.trim(), hash]);
      // Every account starts with a project to put files in.
      const projectId = randomUUID();
      await tx.query('insert into projects (id, name, owner_id) values ($1, $2, $3)', [projectId, 'My project', userId]);
      await tx.query(`insert into project_members (project_id, user_id, role) values ($1, $2, 'owner')`, [projectId, userId]);
      return { id: userId, email, name: req.body.name!.trim() };
    });
    await startSession(reply, user.id);
    return reply.status(201).send({ user });
  });

  app.post<{ Body: Credentials }>('/api/auth/login', { schema: { body: credentials } }, async (req, reply) => {
    const email = req.body.email.trim().toLowerCase();
    const key = `login:${req.ip}:${email}`;
    if (!limiter.take(key)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const { rows } = await db.query<{ id: string; name: string; password_hash: string }>('select id, name, password_hash from users where email = $1', [email]);
    const found = rows[0];
    const ok = await verifyPassword(req.body.password, found?.password_hash ?? (await timingDummy()));
    if (!found || !ok) throw new HttpError(401, 'Email or password is incorrect.');
    limiter.clear(key);
    await startSession(reply, found.id);
    return { user: { id: found.id, email, name: found.name } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await destroySession(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });

  app.get('/api/auth/me', async (req) => ({ user: requireUser(req.user) }));
};
