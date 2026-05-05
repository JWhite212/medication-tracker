# P5 - Email Typed Results + isEmailConfigured

> **Status:** in progress
> **Branch:** `feat/email-typed-results`
> **Owner:** Jamie

**Goal:** Replace the throw-or-silently-ignore pattern in `src/lib/server/email.ts` with an explicit typed result that the caller can branch on. Add `isEmailConfigured()` so feature flags do not have to peek at env. Gate reminder emails on `users.emailVerified` and surface that requirement in the notifications settings UI.

**Architecture:** Senders return `Promise<EmailResult>` instead of `Promise<void>`. The Resend SDK already returns `{ data, error }` rather than throwing on provider errors, so the senders inspect that envelope and map error names to a small set of reasons (`not_configured`, `provider_error`, `invalid_sender_domain`, `rate_limited`). Runtime exceptions (network failures, etc.) are caught and folded into `provider_error`. Tokens never appear in log output. PUBLIC_BASE_URL stays the sole source of outbound links.

**Tech Stack:** Resend SDK, Drizzle, SvelteKit form actions and load functions.

---

## File Structure

- Modify: `src/lib/server/email.ts` (add `EmailResult`, `isEmailConfigured`, refactor senders)
- Modify: `src/routes/auth/register/+page.server.ts` (consume typed result; explicit non-blocking comment)
- Modify: `src/routes/auth/reset-password/+page.server.ts` (consume typed result; log non-sensitive)
- Modify: `src/lib/server/reminders.ts` (gate email on `users.emailVerified`; consume typed result)
- Modify: `src/routes/(app)/settings/notifications/+page.server.ts` (surface `emailVerified`)
- Modify: `src/routes/(app)/settings/notifications/+page.svelte` (verify-email hint)
- Modify: `tests/unit/reminders.test.ts` (mocks return EmailResult; add `emailVerified` to fixtures)
- Create: `tests/unit/email.test.ts` (new unit suite for the typed mapping + isEmailConfigured)

## Task list

### Task 1 - email.ts refactor

- Add `EmailResult` discriminated union and `EmailErrorReason`.
- Add `isEmailConfigured()` reading `RESEND_API_KEY` and a non-empty `EMAIL_FROM` placeholder check.
- Add a private `mapResendError(error)` helper that maps Resend's `RESEND_ERROR_CODE_KEY` strings to our four reasons.
- Wrap all four senders in `try { ... } catch (err) { ... }` and return ok/err results.
- Keep `getBaseUrl()` exactly as-is (PUBLIC_BASE_URL only).
- Keep `escHtml` use on user-controlled values (medication names, last-taken labels).

### Task 2 - auth flows

- `register/+page.server.ts`: keep the existing try/catch around verification; consume the typed result and log a non-sensitive line. Add an explicit comment that registration is non-blocking by policy.
- `reset-password/+page.server.ts`: read result; if not `ok`, log non-sensitive error. Do not change the response so we keep "always returns success" privacy semantics.

### Task 3 - reminders.ts

- Add `users.emailVerified` to the select projection in both query functions.
- Skip the email send when `userEmailVerified !== true`. Log a one-line warning on the email-skipped path.
- Read the typed result for sends that do happen; log non-sensitive errors.
- Push behaviour unchanged in this PR. P3 will split email/push preferences.

### Task 4 - notifications UI

- Load: include `emailVerified` in the returned data.
- Page: when `emailReminders` is on but `emailVerified` is false, show an inline notice: "Verify your email to enable email reminders." with a link to `/auth/verify` (or the existing resend path if available). Do not block saving the preference.

### Task 5 - tests

- `tests/unit/email.test.ts`: import the module under test; mock the Resend client to return each `RESEND_ERROR_CODE_KEY`; assert the typed-result mapping. Plus a happy path returning `{ ok: true, id }`. Plus `isEmailConfigured()` true/false on env.
- `tests/unit/reminders.test.ts`: extend the email mock to return `{ ok: true }`; add `userEmailVerified: true` to existing fixtures so behaviour is unchanged. Add one test where `userEmailVerified: false` results in zero emails but pushes still fire.

### Task 6 - verify and PR

- `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`
- Commit, push, open PR.

## Risks / notes

- The Resend SDK does not throw on provider errors; it returns `{ data, error }`. The current code calls `.send(...)` and discards the response, so a Resend error would be silently ignored today. The refactor surfaces those.
- Push reminders staying on emailReminders-gated path is a known wart that P3 fixes when the prefs split lands. Comment in the code so the next change does not have to rediscover this.
- No schema changes in this PR. P2 and P3 add the schema work.
