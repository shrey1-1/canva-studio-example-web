/**
 * Database access. One small interface over two drivers:
 *  - a real PostgreSQL server (`pg`) when DATABASE_URL is set,
 *  - embedded PostgreSQL (PGlite, Postgres compiled to WebAssembly) otherwise, stored in DATA_DIR
 *    (or in memory for tests).
 * Both speak the same SQL, so the rest of the server does not know which one it uses.
 */
import { mkdirSync } from 'node:fs';
import { MIGRATIONS } from './migrations';

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

export async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return {
    kind: 'pglite',
    query: (sql, params) => pg.query(sql, params as unknown[]) as never,
    transaction: (fn) => pg.transaction((tx) => fn({ query: (sql, params) => tx.query(sql, params as unknown[]) as never })),
    close: () => pg.close(),
  };
}

export async function openPostgres(url: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query('select 1');
  return {
    kind: 'postgres',
    query: (sql, params) => pool.query(sql, params) as never,
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn({ query: (sql, params) => client.query(sql, params) as never });
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** Applies migrations that have not run yet, each in its own transaction. Returns the versions applied. */
export async function migrate(db: Db): Promise<number[]> {
  await db.query('create table if not exists schema_migrations (version integer primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ version: number }>('select version from schema_migrations')).rows.map((r) => r.version));
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await db.transaction(async (tx) => {
      for (const statement of m.sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await tx.query(statement);
      await tx.query('insert into schema_migrations (version) values ($1)', [m.version]);
    });
    applied.push(m.version);
  }
  return applied;
}
