# ADR 0002: Drizzle ORM on Postgres (Neon)

- **Status**: Accepted
- **Date**: 2026-04-15
- **Deciders**: Jamie White

## Context

The schema is small but relational: users own medications and dose
logs; reminders need idempotency rows; sessions need cascade-delete.
We need timezone-aware timestamps, JSONB for side-effect arrays, and
the ability to add columns confidently. The deployment target is
Vercel, so the database has to play well with serverless functions.

## Decision

Use **Drizzle ORM** for schema and queries, **Postgres** as the
database, and **Neon's serverless HTTP driver** in production.

## Alternatives considered

- **Prisma** — superb ergonomics but the generated client and the
  Rust-based query engine inflate the bundle and add cold-start time
  on Vercel functions. Schema migrations also require a separate
  workflow.
- **Kysely** — type-safe query builder with no schema DSL, similar
  philosophy to Drizzle. Would have worked, but Drizzle's `pgTable`
  declarations double as the source of truth for migrations and
  Lucia's session adapter, which removes a class of drift bugs.
- **Raw SQL with @neondatabase/serverless** — too much hand-rolling
  for the size of the app; type safety on result rows would be
  manual.
- **SQLite (libSQL/Turso)** — attractive for personal-use apps but
  the project intentionally exercises a Postgres-shaped schema
  (JSONB, partial indexes, cascade deletes) to mirror what would be
  used in a real product environment.

## Consequences

**Positive**

- One source of truth (`src/lib/server/db/schema.ts`); query results
  are typed without code generation.
- Drizzle migrations are plain SQL files — reviewable, editable, and
  hand-augmentable for data backfills (we did this for the legacy
  `quantity=0/notes='Skipped'` to `status='skipped'` migration).
- Neon's HTTP driver works on the edge, so route loaders stay fast
  even when cold.

**Negative**

- The project initially used `drizzle-kit push` (no migration files)
  for the first few schema changes. Migration history was
  reconciled in Phase 2; the wrinkle is documented in
  `docs/database.md`.
- Drizzle's relational queries are evolving — for now we use the
  basic `select/from/where` API and skip `with: { ... }` joins to
  keep the surface stable.
