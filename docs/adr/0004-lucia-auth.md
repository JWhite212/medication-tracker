# ADR 0004: Lucia v3 for session auth, Argon2 for passwords

- **Status**: Accepted
- **Date**: 2026-04-15
- **Deciders**: Jamie White

## Context

The app needs first-party email/password auth, optional OAuth
(Google, GitHub) for portfolio polish, and TOTP-based 2FA for
sensitive accounts. Sessions must be revocable from the user's own
settings page (active-sessions list) and from the password-reset
flow (Phase 1 invalidation). Auth code that wraps DB schemas tightly
is a known footgun; the auth layer should be replaceable without a
rewrite.

## Decision

Use **Lucia v3** for session management with the
`@lucia-auth/adapter-drizzle` adapter so sessions live in our
Postgres `sessions` table. Hash passwords with **Argon2id** via
`@node-rs/argon2`. Use **arctic** for OAuth flows (Google + GitHub).
Use **@oslojs/otp** for TOTP, with secrets encrypted at rest with
AES-256-GCM (see Phase 1).

## Alternatives considered

- **NextAuth / Auth.js** — heavier, opinionated about routing,
  awkward to drop into SvelteKit form actions.
- **Clerk / Supabase Auth / Auth0** — managed solutions are great
  but they hide the schema, the audit story, and the security
  reasoning that's the whole point of building a portfolio app
  around health data.
- **Hand-rolled sessions** — works for a side project but the
  reset/expiry/cookie-rotation details are easy to get wrong.
- **JWT-only** — no easy revocation, password-reset session
  invalidation becomes much harder.

## Consequences

**Positive**

- Sessions are first-class rows we can query: list active devices,
  revoke one, revoke all on password change (Phase 1 §8).
- Argon2id is the OWASP-recommended password hash; tuned defaults
  via `@node-rs/argon2`'s native bindings.
- TOTP secrets are now encrypted at rest with a versioned scheme
  (`v1:iv:tag:ct`) so future key rotation has a place to live.

**Negative**

- Lucia v3 is intentionally minimal — features like email
  verification, account linking, and 2FA are stitched together
  ourselves. The wiring is documented in
  `src/lib/server/auth/`.
- The OAuth account-takeover guard (refusing auto-link to a
  password-bearing account) is hand-rolled in
  `auth/callback/[provider]/+server.ts`.
