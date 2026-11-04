/**
 * Passwords and sessions.
 *  - Passwords: scrypt (Node's built-in crypto) with a random salt, compared in constant time.
 *  - Sessions: a random 32-byte token in an httpOnly cookie; only its SHA-256 hash is stored, so a
 *    database leak does not leak usable sessions.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import type { Queryable } from './db';

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export const SESSION_COOKIE = 'cs_session';
export const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, key] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to compare against when the email is unknown, so timing does not reveal which emails exist. */
let dummyHash: Promise<string> | null = null;
export const timingDummy = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')));

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(db: Queryable, userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.query('insert into sessions (token_hash, user_id, expires_at) values ($1, $2, $3)', [tokenHash(token), userId, expires.toISOString()]);
  return { token, expires };
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function userForSession(db: Queryable, token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const { rows } = await db.query<SessionUser>(
    `select u.id, u.email, u.name from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [tokenHash(token)],
  );
  return rows[0] ?? null;
}

export async function destroySession(db: Queryable, token: string | undefined): Promise<void> {
  if (token) await db.query('delete from sessions where token_hash = $1', [tokenHash(token)]);
}

/**
 * Fixed-window limiter for login/signup attempts, per key (IP + email). In-memory: enough for a
 * single server process; a multi-instance deployment would move this to the database or Redis.
 */
export class AttemptLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** Returns false when the key has used up its attempts. */
  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    const entry = this.hits.get(key);
    if (!entry || entry.reset < now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.max;
  }

  clear(key: string) {
    this.hits.delete(key);
  }
}
