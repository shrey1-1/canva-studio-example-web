# 0005. Fastify API with PostgreSQL, embedded (PGlite) by default

Date: 2026-11-04
Status: Accepted

## Context
Phase 6 moves files from the browser to a server, with accounts, projects, roles, version
history and image storage. PostgreSQL was the chosen database. This development machine has
neither PostgreSQL nor Docker, and installing PostgreSQL 17 with winget failed: the download
server returned 403.

## Decision
- **Server:** Fastify 5 in a new `apps/server` workspace, run with `tsx`. It reuses
  `@canvas-studio/core` to validate every document it stores.
- **Database:** PostgreSQL behind a small `Db` interface.
  - With `DATABASE_URL` set, it uses `pg` (a real server).
  - Without it, it uses PGlite, which is PostgreSQL compiled to WebAssembly, stored in
    `apps/server/data/db`.
  - Both run the same SQL and migrations. Tests use an in-memory PGlite.
- **Auth:**
  - scrypt from Node's crypto, so no native or extra crypto package.
  - Session tokens stored as SHA-256 hashes, in an httpOnly SameSite=Lax cookie.
  - CSRF protection: a required custom header on non-GET requests, and no CORS at all.
- **Concurrency:** optimistic revisions (409 on a stale save). Real-time merging is Phase 7.

## Alternatives considered
- **SQLite:** simpler, but not the approved database, and it would need a second SQL dialect later.
- **Docker Postgres:** Docker is not installed.
- **An ORM (Prisma or Drizzle):** a large dependency for eight tables. Plain parameterised SQL is
  easy to review.
- **JWT sessions:** they cannot be revoked server-side without a store anyway. Opaque tokens in
  the database are simpler, and logout really ends the session.

## Consequences
- `npm run dev` works with no database install. Moving to a hosted PostgreSQL is a config change.
- PGlite is single-process. Production should set `DATABASE_URL`.
- The rate limiter is in memory (one server process). Unused images are not garbage-collected yet.
