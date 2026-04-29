# Architecture Decision Records

Short, dated records of meaningful technical decisions. Each ADR is
immutable once accepted; if a decision changes, add a new ADR that
supersedes it.

## Index

- [0001 — SvelteKit as the application framework](./0001-sveltekit.md)
- [0002 — Drizzle ORM on Postgres (Neon)](./0002-drizzle-postgres.md)
- [0003 — Server-first data flow with SvelteKit form actions](./0003-server-first-form-actions.md)
- [0004 — Lucia v3 for session auth, Argon2 for passwords](./0004-lucia-auth.md)
- [0005 — Idempotent reminder dispatch via dedupe key](./0005-reminder-deduplication.md)

## Format

Each ADR follows the [Michael Nygard pattern](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):
**Status**, **Context**, **Decision**, **Alternatives considered**,
**Consequences**.
