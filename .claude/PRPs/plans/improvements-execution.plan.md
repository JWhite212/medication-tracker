# Improvements execution plan

Companion to `improvements-broad.plan.md`. Records execution decisions, ordering, and per-phase scope.

## Decisions (locked)

| #   | Question                 | Decision                                                                           |
| --- | ------------------------ | ---------------------------------------------------------------------------------- |
| 1   | Scope                    | Implement Phase 1, then Phase 2; re-evaluate before Phase 3 / 4                    |
| 2   | PR strategy              | One PR per phase (4 PRs total)                                                     |
| 3   | Migrations               | Switch to file-based `drizzle-kit migrate` now                                     |
| 4   | TOTP encryption rollout  | One-shot migration script run once at deploy                                       |
| 5   | Re-auth                  | Server-side `reauth_tokens` table                                                  |
| 6   | Drug interactions        | Keep behind `INTERACTIONS_ENABLED=true`, label "Experimental"                      |
| 7   | Scheduling refactor (#9) | Land in Phase 4                                                                    |
| 8   | Demo account             | Seed `demo@medtracker.app` with sample data; expose via "Try the demo" CTA         |
| 9   | README                   | Overwrite in place                                                                 |
| 10  | Coverage                 | Phase 2 collects baseline (no thresholds); Phase 3 adds regression-only thresholds |

## Branch / PR map

| PR  | Branch                      | Phase                                                                                                                                                                      |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `feat/phase-1-hardening`    | Hardening: ownership, status column, reminder dedup, analytics correctness, secure cookies, TOTP encryption, reauth, session invalidation, CSV/PDF safety, time formatting |
| 2   | `feat/phase-2-repo-quality` | CI, ESLint + Prettier, coverage reporting, drizzle migration scripts, `.env.example` completion                                                                            |
| 3   | `feat/phase-3-tests`        | Server unit + analytics + auth + E2E + a11y tests; coverage thresholds                                                                                                     |
| 4   | `feat/phase-4-polish`       | Medication schedule model, disclaimer, interactions feature flag, KeyboardShortcuts fix, empty-state assets, README rewrite, ADRs, case study, demo seed                   |

## Phase 1 — execution order

Schema-first to avoid breaking analytics/queries mid-flight.

1. **Foundations (schema + migrations)**
   1. New migration: `dose_logs.status` column (default `'taken'`), backfill `quantity=0 AND notes='Skipped'` → `'skipped'`
   2. New migration: `reminder_events` table with unique `dedupe_key`
   3. New migration: `reauth_tokens` table
2. **Cookie security (small, isolated)** 4. `secure: !dev` for OAuth state, Google PKCE verifier, pending 2FA cookies
3. **Auth correctness** 5. Invalidate sessions after password reset confirm 6. Ownership guard helper used by `logDose` / `logSkippedDose`
4. **TOTP encryption** 7. AES-256-GCM helper (`src/lib/server/auth/crypto.ts`) using `ENCRYPTION_KEY` 8. Update `totp.ts` to encrypt on enroll, decrypt on verify, lazy-decrypt for legacy plaintext 9. One-shot migration script `scripts/encrypt-totp-secrets.ts`
5. **Re-authentication gate** 10. `requireRecentReauth(userId)` helper, used by: enable/disable 2FA, change password, delete account, full export, revoke sessions
6. **Analytics correctness (depends on #1)** 11. `analytics.ts` filters `status='taken'`; expose `takenDoseEvents`, `takenQuantity`, `skippedCount`, `missedCount`, `adherencePercent` (cap 100), `overusePercent` 12. `getLastDosePerMedication` filters `status='taken'`
7. **Output formatting / safety** 13. `formatUserTime(date, tz, timeFormat)` consumed by dashboard / timeline / history / analytics / CSV / PDF / email 14. CSV: escape `=+-@` formula-injection prefix, newlines, CRLF, quotes 15. PDF: header (user, range, tz), medication summary, dose log, adherence, side-effect summary, generated-at, disclaimer

## Phase 2 — execution order

1. ESLint flat config + Prettier + `prettier-plugin-svelte`
2. `lint`, `format`, `format:check` scripts
3. `db:generate`, `db:migrate`, `db:push`, `db:studio` scripts
4. `.env.example`: add `EMAIL_FROM`, `PUBLIC_BASE_URL`, with comments on every entry
5. `vitest.config.ts` with `coverage` block (v8 provider, no thresholds yet)
6. `.github/workflows/ci.yml`: install → check → lint → format:check → test (with coverage upload) → build
7. `docs/database.md` describing tables, relationships, indexes, migration workflow

## Out of scope until Phase 4

- `medication_schedules` table
- Drug interactions feature flag rebrand
- `KeyboardShortcuts` move-to-dashboard
- Empty-state asset wiring on every state
- README rewrite
- ADR documents
- Case study
- Demo seed
