# ADR 0003: Server-first data flow with SvelteKit form actions

- **Status**: Accepted
- **Date**: 2026-04-15
- **Deciders**: Jamie White

## Context

A medication tracker is mutation-heavy: log dose, edit dose, skip
dose, add medication, change preference, etc. We need every mutation
to be:

- Auth-checked server-side.
- Auditable (the `audit_logs` table records create/update/delete with
  JSONB diffs).
- Tolerant of partial JS — if a user's browser has JS disabled or
  fails, the form should still submit and re-render.

Calling JSON APIs from the client and managing optimistic UI by hand
would multiply the surface area for security mistakes (forgotten
ownership checks, missing CSRF protection, request-replay holes).

## Decision

Use **SvelteKit form actions with `use:enhance`** for every mutation.
No client-side `fetch` to internal JSON endpoints for write paths.
Read paths fetch via `+page.server.ts` loaders and pass typed data to
the page.

## Alternatives considered

- **JSON REST endpoints + a client cache** — more conventional, but
  doubled the auth and ownership-check surface. SvelteKit's loader/
  action model lets `locals.user` flow through `hooks.server.ts` to
  every action without per-route plumbing.
- **tRPC** — keeps types end-to-end but adds a runtime layer that
  the form actions don't need. The bundle savings of going without
  tRPC matters on the slower mobile target the PWA aims at.
- **Server actions à la Next** — SvelteKit's are arguably cleaner
  because the form falls back to a real POST when JS is unavailable.

## Consequences

**Positive**

- Every mutation re-renders fresh server state on success — no stale
  cache to invalidate.
- `use:enhance` keeps the optimistic feel without needing a
  client-side store.
- Re-auth gate (Phase 1) and rate limit (Phase 1 / earlier) plug in
  cleanly because they live next to the action body.

**Negative**

- Some interactions (e.g., live dose-time-since counter) still need
  client state. We accept that and keep those islands small.
- Action return shapes are TypeScript discriminated unions across
  every `fail()` call; we worked around the narrowing in templates
  with a typed `errors` cast (Phase 2 / Phase 3 fix-types commit).
