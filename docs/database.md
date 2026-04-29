# Database

MedTracker uses Postgres (Neon in production, but any Postgres-compatible
database works). Schema is managed with Drizzle ORM. Migrations live in
`drizzle/` and are version-controlled.

## Stack

- **Driver**: `@neondatabase/serverless` (HTTP/WS)
- **ORM**: `drizzle-orm` 0.45+
- **Migration tooling**: `drizzle-kit` 0.31+
- **Adapter for sessions**: `@lucia-auth/adapter-drizzle`

## Connection

A single connection string drives the database client:

```
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
```

`sslmode=require` is mandatory for Neon and any managed Postgres.

## Tables

### `users`

Primary key on `id` (cuid2). Email is unique and lowercased at the
application layer. `password_hash` is null for OAuth-only accounts.
`totp_secret` is encrypted at rest using AES-256-GCM
(`v1:<iv>:<tag>:<ct>` format) — see `src/lib/server/auth/crypto.ts`.

### `sessions`

Lucia-managed. One row per active browser. Cascade-deletes when the user
is removed. Index on `user_id` for fast lookup-by-user.

### `oauth_accounts`

Composite primary key `(provider, provider_user_id)`. Links an OAuth
identity to an internal `user_id`.

### `medications`

User-owned. Composite index `(user_id, is_archived)` keeps the active
list query fast. `colour` and `colour_secondary` drive the
two-tone palette; `pattern` toggles solid / dotted / striped fills.

`schedule_type` and `schedule_interval_hours` are **DEPRECATED** as
of Phase 4d — see `medication_schedules` for the canonical schedule
shape. They remain populated for one rollout cycle and will be
dropped in a follow-up migration.

### `medication_schedules` (Phase 4d)

Owns the schedule for a medication, with one row per slot. A
medication may have multiple rows. `schedule_kind` is one of:

- `interval` — `interval_hours` set; project forward by N hours.
- `fixed_time` — `time_of_day` set as `HH:mm` in the user's
  timezone; optional `days_of_week` (jsonb int array, 0=Sun..6=Sat,
  null/empty = every day).
- `prn` — no further fields; medication is logged on demand only.

Indexes on `medication_id` and `user_id`. Cascade-deletes when the
parent medication or user is removed. Backfilled from the legacy
`medications.schedule_type` / `schedule_interval_hours` columns by
`0006_phase_4d_schedules.sql` using a deterministic
`'sched_' || md5(medication_id)` key so re-runs are idempotent.

### `dose_logs`

User-owned, references a medication. New `status` column (Phase 1) is
one of `'taken' | 'skipped' | 'missed'`, default `'taken'`. The legacy
`quantity=0 + notes='Skipped'` representation was migrated to
`status='skipped'` by `0005_phase_1_hardening.sql`.

Indexes:

- `dose_logs_user_taken_idx (user_id, taken_at)` — main "today" / "history" queries
- `dose_logs_med_taken_idx (medication_id, taken_at)` — per-medication analytics
- `dose_logs_user_status_taken_idx (user_id, status, taken_at)` — adherence analytics

### `audit_logs`

Append-only audit trail. JSONB `changes` stores diffs for
create/update/delete on user, medication, and dose_log entities.

### `user_preferences`

One row per user (`user_id` PK). Settings such as accent colour,
date/time format, UI density, reminder cadence, export format. All
have non-null defaults so a new user works without a settings touch.

### `rate_limits`

Sliding-window counter keyed by string (e.g., `login:<ip>` or
`reset:<email>`). Reset time stored in `reset_at`.

### `push_subscriptions`

Web Push endpoints. Endpoint is unique. Cascade-deletes on user
removal.

### `email_verification_tokens`, `password_reset_tokens`

Hashed token + expiry for the two transactional email flows. Tokens
are SHA-256-hashed before storage.

### `reminder_events` (Phase 1)

Idempotency record for reminder dispatch. Unique constraint on
`dedupe_key` ensures the same reminder can't fire twice. Dedupe key
format: `${userId}:${medicationId}:${reminderType}:${nextDueAt.toISOString()}`.

### `reauth_tokens` (Phase 1)

Server-side store backing `requireRecentReauth()` for sensitive
actions (2FA toggle, password change, account deletion, full export,
revoke-all-sessions). Each row carries a SHA-256-hashed token, a
`purpose` discriminator, an expiry (5 min), and a nullable `used_at`
so a token can only be redeemed once.

## Migration workflow

The project switched from `drizzle-kit push` to file-based
`drizzle-kit migrate` in Phase 2. The legacy `push` script is kept
for emergency situations only.

```bash
# 1. Edit src/lib/server/db/schema.ts
# 2. Generate a migration from the schema diff
npm run db:generate

# 3. Inspect the generated SQL in drizzle/<NNNN>_<name>.sql
# 4. Append any data migrations (UPDATE statements) by hand if needed
# 5. Apply the migration to the database
npm run db:migrate
```

Useful commands:

| Command               | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `npm run db:generate` | Diff schema → produce a new SQL migration file        |
| `npm run db:migrate`  | Apply all pending migrations                          |
| `npm run db:push`     | (Legacy) push schema directly without migration files |
| `npm run db:studio`   | Open the Drizzle Studio web UI on localhost           |

## Local setup

1. Install Postgres locally or run via Docker:
   ```bash
   docker run --name medtracker-pg -e POSTGRES_PASSWORD=dev \
     -p 5432:5432 -d postgres:16
   ```
2. Set `DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres`
3. Run `npm run db:migrate`
4. Optional: open Drizzle Studio to inspect rows: `npm run db:studio`

## Seed data

`scripts/seed-demo.ts` (run via `npm run seed:demo`) seeds the
`demo@medtracker.app` portfolio account. It is idempotent — the
existing demo user is deleted first, which cascade-clears every
owned row, then the script re-inserts:

- The user (password `demo-medtracker-2026`, timezone `Europe/London`,
  email-verified, email reminders disabled).
- Five medications spanning supplements, prescriptions, and OTC.
- ~30 days of dose history with per-medication take-rates so the
  analytics page reflects realistic adherence and one or two
  medications surface light side-effects.

Use this script to re-seed after a schema migration or to refresh
demo data before taking screenshots:

```bash
DATABASE_URL=postgresql://... npm run seed:demo
```

## Out-of-band history note

Migrations 0000–0004 cover most tables, but a handful
(`email_verification_tokens`, `password_reset_tokens`) were initially
created via `drizzle-kit push` and only entered the migration history
retroactively. Drizzle's snapshot files are now the source of truth;
new generations diff against the latest snapshot, not the SQL file
contents.
