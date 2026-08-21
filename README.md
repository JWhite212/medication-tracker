# MedTracker

A full-stack medication tracker focused on fast dose logging, live
timers, adherence analytics, secure auth, and exportable history.
Built with SvelteKit 2 (Svelte 5 runes), TypeScript, Drizzle ORM,
and Postgres.

[![CI](https://github.com/JWhite212/medication-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/JWhite212/medication-tracker/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-22-brightgreen)](https://nodejs.org)
[![SvelteKit](https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white)](https://svelte.dev)
[![Deploy](https://img.shields.io/badge/Vercel-deployed-black?logo=vercel)](https://vercel.com)

## Table of contents

1. [Overview](#overview)
2. [Live demo](#live-demo)
3. [Quickstart](#quickstart)
4. [Screenshots](#screenshots)
5. [Core features](#core-features)
6. [Feature status](#feature-status)
7. [Technical highlights](#technical-highlights)
8. [Architecture](#architecture)
9. [For technical reviewers](#for-technical-reviewers)
10. [Engineering decisions](#engineering-decisions)
11. [Security and privacy](#security-and-privacy)
12. [Accessibility](#accessibility)
13. [Performance](#performance)
14. [Database design](#database-design)
15. [Testing strategy](#testing-strategy)
16. [Local development](#local-development)
17. [Environment variables](#environment-variables)
18. [What I learned](#what-i-learned)
19. [Known limitations](#known-limitations)
20. [Known follow-ups](#known-follow-ups)
21. [Roadmap](#roadmap)
22. [Dependency policy](#dependency-policy)
23. [License](#license)

## Overview

MedTracker is a personal medication tracking web app. It is a
**tracking tool**, not medical advice — see the disclaimer surfaced
across the UI and the [medical disclaimer note](#medical-disclaimer)
below. The project is built as a portfolio piece: the goal is to
show end-to-end full-stack judgement, not to add yet another feature.

Read the long-form story in [`docs/case-study.md`](docs/case-study.md).

## Live demo

- App: <https://medication-tracker.jamiewhite.site/>
- Demo account: `demo@medtracker.app` / `demo-medtracker-2026`.
  Seeded with five medications and ~30 days of dose history so the
  dashboard, log, and analytics pages reflect a populated state.

Refresh the demo (deletes and recreates the demo user, idempotent):

```bash
DATABASE_URL=... npm run seed:demo
```

## Quickstart

Run locally in 60 seconds (Node 22, free Neon Postgres tier):

```bash
git clone https://github.com/JWhite212/medication-tracker.git
cd medication-tracker
npm install
cp .env.example .env                 # set DATABASE_URL (Neon pooled URL with sslmode=require)
npm run db:migrate                   # apply Drizzle migrations
npm run seed:demo                    # optional: seed the demo account
npm run dev                          # http://localhost:5173
```

Verify with `curl http://localhost:5173/api/health`. Full deployment
runbook in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Screenshots

![Animated tour of MedTracker: dashboard with live timers, medications list, add-medication form, dose history, and adherence analytics](docs/screenshots/demo.gif)

![MedTracker dashboard](docs/screenshots/hero-dashboard.png)

|                                                  |                                                        |
| ------------------------------------------------ | ------------------------------------------------------ |
| ![Medications](docs/screenshots/medications.png) | ![Add Medication](docs/screenshots/add-medication.png) |
| _Medications_                                    | _Add Medication_                                       |
| ![History](docs/screenshots/history.png)         | ![Analytics](docs/screenshots/analytics.png)           |
| _History_                                        | _Analytics_                                            |

## Core features

- **Quick log** — single-tap dose logging with optimistic UI and
  audit trail.
- **Live timers** — per-medication "last taken" + "next due"
  countdowns recomputed every minute, with a `visibilitychange`
  catch-up.
- **Adherence analytics** — heatmap, daily counts, per-medication
  rollups, hourly + day-of-week distribution, side-effect frequency.
- **Reminders** — opt-in email and Web Push, dispatched by Vercel
  Cron with idempotent dedupe keys (see [ADR 0005](docs/adr/0005-reminder-deduplication.md)).
- **Exports** — PDF (with adherence summary, medication list,
  side-effect frequency, medical disclaimer) or CSV (formula-injection
  safe).
- **Auth** — email + password (Argon2id) and OAuth (Google, GitHub).
  TOTP 2FA with secrets encrypted at rest.

## Feature status

Honest about what's complete vs. what's planned:

| Feature                          | Status                                                                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email/password auth              | Complete                                                                                                                                                       |
| OAuth (Google, GitHub)           | Complete; account-takeover guard in place                                                                                                                      |
| 2FA (TOTP)                       | Complete; secrets encrypted at rest with AES-256-GCM                                                                                                           |
| Dose logging + edit + skip       | Complete; ownership-checked, status-aware                                                                                                                      |
| Adherence analytics              | Complete; cap-at-100 + overuse split                                                                                                                           |
| Email reminders                  | Complete; typed `EmailResult`, per-channel status, retry-after-cooldown via `reminder_events`                                                                  |
| Web Push reminders               | Complete; per-channel opt-in, claim/complete dispatch                                                                                                          |
| Notification preferences         | Complete; account-wide toggles (overdue email/push, low-inventory email/push) with per-medication overrides and a bounded, repeat-until-acted reminder cadence |
| PDF / CSV export                 | Complete; formula-injection escape, en-GB time format, audit log CSV                                                                                           |
| Inventory event history          | Complete; refill workflow, per-event timeline on `/medications/[id]`                                                                                           |
| Drug interaction notice          | Experimental, behind `INTERACTIONS_ENABLED` flag                                                                                                               |
| Medical disclaimer               | Surfaced on landing, register, medication form, analytics, exports                                                                                             |
| Re-auth gate (sensitive actions) | Complete for change-password, enable/disable 2FA, delete account, wipe dose history, wipe archived medications, revoke other sessions                          |
| Medication scheduling            | Interval, fixed-time, and PRN; multi-row schedules with optional day-of-week filters                                                                           |
| Atomic medication creation       | Complete; `createMedicationWithSchedules` runs medication + schedules + audit in one transaction                                                               |
| Privacy & data controls          | Complete; `/settings/privacy` with stored/not-stored copy, scoped wipes, session revocation, audit-log CSV                                                     |
| Demo account + seed              | Complete; `npm run seed:demo` (4c)                                                                                                                             |
| End-to-end tests                 | Complete; Playwright journeys for auth, medication lifecycle, dose logging, analytics, history filters, exports, axe                                           |

## Technical highlights

- **Server-first SvelteKit** — every mutation is a form action; no
  client-side data fetching for write paths. See [ADR 0003](docs/adr/0003-server-first-form-actions.md).
- **AES-256-GCM at rest** for TOTP secrets with versioned payload
  format (`v1:iv:tag:ct`) and a one-shot migration script
  (`scripts/encrypt-totp-secrets.ts`).
- **Idempotent reminder dispatch** via unique `dedupe_key` rows in
  `reminder_events`. See [ADR 0005](docs/adr/0005-reminder-deduplication.md).
- **Centralised time formatting** — `formatUserTime(date, tz, '12h'|'24h')`
  threaded through dashboard, timeline, log, exports, emails so
  everything agrees.
- **Hardened CSV escaping** — `escapeCsvCell` neutralises formula
  injection prefixes (`= + - @ \t \r`) plus standard CSV escape
  rules; CRLF line endings per RFC 4180.
- **Pure analytics functions** — `buildInsights` is a deterministic,
  unit-testable predicate over already-computed stats; new rules are
  one-line additions and never inject prescriptive medical wording.
- **Coverage thresholds as regression floors** — measured baseline
  in `vite.config.ts`, set just below current so legitimate refactor
  noise doesn't fail CI but real regressions do.

## Architecture

```
+-------------------+
|  Browser / PWA    | <-- service worker for offline shell + push
+---------+---------+
          |
          v
+---------+---------+         +--------------------+
|  SvelteKit edge   |  -->    |  Resend (email)    |
|  (Vercel)         |         +--------------------+
|                   |
|  - Loaders        |         +--------------------+
|  - Form actions   |  -->    |  Web Push          |
|  - API endpoints  |         +--------------------+
|  - Cron handler   |
+---------+---------+         +--------------------+
          |                   |  OpenFDA labels    |
          | Drizzle ORM       |  (feature-flagged) |
          v                   +--------------------+
+---------+---------+
| Postgres (Neon)   |
| users · sessions  |
| medications       |
| dose_logs (status)|
| reminder_events   |
| reauth_tokens     |
| audit_logs ...    |
+-------------------+
```

For Mermaid diagrams of the system overview, the reminder-dispatch
sequence, and the data model, see
[`docs/architecture.md`](docs/architecture.md). The architectural
decisions are recorded in [`docs/adr/`](docs/adr/).

## For technical reviewers

Short, opinionated tour of the eight files I'd start with as a reviewer
who has 30 minutes:

1. [`src/lib/server/db/schema.ts`](src/lib/server/db/schema.ts) - the
   complete data model in one file. Foreign keys, indexes, and the
   reminder/inventory event status fields all live here. Skim to
   ground every later trace in concrete tables.
2. [`src/lib/server/doses.ts`](src/lib/server/doses.ts) - dose
   lifecycle (log, skip, edit, delete) with transactional inventory
   adjustments. Demonstrates the `dbTx.transaction` + audit pattern
   that the rest of the service layer follows.
3. [`src/lib/server/reminders.ts`](src/lib/server/reminders.ts) - the
   cron entrypoints. Shows the claim/complete dispatch flow, the
   per-channel split, and how email-not-verified is gated separately
   from push subscriptions.
4. [`src/lib/server/reminders/domain.ts`](src/lib/server/reminders/domain.ts) -
   pure overdue-slot computation and dedupe-key generation. Decoupled
   from DB so it's exhaustively tested.
5. [`src/lib/server/analytics.ts`](src/lib/server/analytics.ts) -
   adherence and insight generation. Pure functions over already-
   computed stats; new rules are one-line predicates.
6. [`src/lib/server/email.ts`](src/lib/server/email.ts) - typed
   `EmailResult` discriminated union with `mapResendError`. Senders
   never throw on provider errors; runtime exceptions fold into
   `provider_error`. Tokens, recipients, and HTML payloads never
   appear in error messages.
7. [`.github/workflows/ci.yml`](.github/workflows/ci.yml) - the CI
   gate. Type-check, lint, format, unit tests with coverage floors,
   secret scan, build, and a gated E2E job that runs Playwright
   against a Neon test branch.
8. [`tests/e2e/`](tests/e2e/) - Playwright journeys covering auth,
   medication lifecycle, dose logging, analytics, history filters,
   exports, and an axe-core accessibility scan. Deterministic
   `seed-e2e.ts` user; storageState reused via Playwright projects.

The corresponding tests live alongside under `tests/unit/` (309+ unit
tests) and `tests/e2e/` (8 spec files). The test suite has been the
forcing function for most of the architectural choices above - several
P5-P8 bugs were caught only because their unit tests pinned the
contract first.

## Engineering decisions

Each significant choice is captured as a short ADR. They explain not
just what, but the alternatives weighed and the consequences accepted:

- [ADR 0001 — SvelteKit as framework](docs/adr/0001-sveltekit.md):
  why server-first SSR over Next.js or Remix for this workload.
- [ADR 0002 — Drizzle ORM + Postgres](docs/adr/0002-drizzle-postgres.md):
  why Drizzle's thin SQL layer over Prisma's heavier abstraction.
- [ADR 0003 — Server-first form actions](docs/adr/0003-server-first-form-actions.md):
  the architectural backbone for mutations.
- [ADR 0004 — Lucia v3 auth + Argon2id](docs/adr/0004-lucia-auth.md):
  rolled-own session table over an off-the-shelf auth provider.
- [ADR 0005 — Reminder deduplication](docs/adr/0005-reminder-deduplication.md):
  the idempotency-key design for cron-driven notifications.
- [ADR 0006 — Multi-row medication schedules](docs/adr/0006-medication-schedules.md):
  schema model for fixed-time, interval, and PRN schedules.

## Security and privacy

- **Passwords** hashed with Argon2id via `@node-rs/argon2`
  (memoryCost 19456, timeCost 2 — OWASP minimum recommendations).
- **Sessions** are server-side rows; revocable from settings, all
  invalidated after a password reset _and_ after a password change.
- **TOTP secrets** encrypted at rest (AES-256-GCM, see Phase 1).
- **OAuth** refuses auto-link to a password-bearing account
  (account-takeover prevention).
- **Re-auth gate** for sensitive actions writes a row to
  `reauth_tokens` for audit.
- **Rate limits** on login, register, password reset, email
  verification, `/api/interactions`, and `/api/export` — sliding
  window stored in `rate_limits`.
- **Query-param validation** — paginated and date-ranged loaders
  reject out-of-range or malformed input via Zod (no large-OFFSET
  DoS, no silent fallback on bad dates).
- **Parameterised queries** via Drizzle; raw `sql.raw(...)` reserved
  for whitelisted timezone identifiers.
- **CSRF** by SvelteKit form-action default; OAuth state cookie
  with `secure: !dev`.
- **Security headers** — `X-Frame-Options: DENY`, HSTS in prod
  only, expanded `Permissions-Policy` blocking camera, mic,
  geolocation, accelerometer, gyroscope, magnetometer, ambient-light,
  payment, USB; `X-Content-Type-Options: nosniff`;
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **CSP** — set in `svelte.config.js` adapter config:
  `default-src 'self'`, scripts/connect/worker `'self'`,
  `object-src 'none'`, `frame-src 'none'`.
- **Audit log** — every create/update/delete on user-owned data
  records a JSONB diff in `audit_logs` (user-scoped, append-only).
- **At rest** — Neon Postgres encrypted by the provider; SSL
  required (`?sslmode=require` in `DATABASE_URL`).
- **Secret-scanning** — Gitleaks runs in CI on every PR.
- **Vulnerability reports** — see [`SECURITY.md`](SECURITY.md).

### Medical disclaimer

> MedTracker is a personal tracking tool. It does not provide
> medical advice, dosage recommendations, diagnosis, or emergency
> guidance. Always follow advice from a qualified healthcare
> professional.

## Accessibility

The target is WCAG 2.2 AA. The Phase 4 accessibility plan
([`.claude/PRPs/plans/completed/accessibility-wcag-2-2-aa.plan.md`](.claude/PRPs/plans/completed/accessibility-wcag-2-2-aa.plan.md))
shipped these foundations:

- **Skip link** to `#main-content` rendered first in `app.html` and
  visible-on-focus.
- **Semantic landmarks** — every page has exactly one `<h1>`, a
  `<main>` element, and `<nav>` for the sidebar with `aria-current="page"`.
- **Keyboard navigation** — global shortcuts (`/` focus search,
  `n` add medication, `1-9` quick-log, `?` help) plus `Esc` closes
  modals; focus is trapped inside the dose-edit modal and restored
  on close.
- **Reduced-motion** — `prefers-reduced-motion: reduce` disables
  all keyframe animations and shortens transitions; the heatmap's
  staggered fade-in zeroes its `animation-delay` under the same media
  query.
- **High-contrast mode** — `prefers-contrast: more` overrides text
  tokens and brightens the accent.
- **Contrast** — primary text on surface ~19:1; secondary text ~7:1;
  the side-effect "mild" pill was lifted from a borderline ~3:1 to
  > 9:1 (well past WCAG AAA) in Phase 5.
- **Form fields** — every input has an associated `<label>`, plus
  `aria-invalid`, `aria-describedby`, and `aria-required` driven
  through the shared `Input.svelte` primitive.
- **Live regions** — the toast container is `aria-live="polite"`;
  TimeSince counters update silently to avoid screen-reader chatter.
- **Icon-only buttons** — the reorder controls use `aria-label="Move
{medication} up/down"` and disable on no-op moves; arrow glyphs
  are wrapped in `aria-hidden`.

## Performance

- **Server-rendered first paint** — every authenticated page loads
  via `+page.server.ts`; the client never fetches data on mount.
- **No client-side data library** — no SWR, no React Query
  equivalent; SvelteKit's loaders + `use:enhance` cover the surface.
- **Inline-SVG sparkline** rather than a chart library
  (`buildSparklineShape` lives in `src/lib/utils/sparkline.ts` and
  is unit-tested).
- **Tailwind v4 atomic CSS** — JIT compiled, ~10 KB on the wire
  for the app shell.
- **Edge-cached static assets** — Vercel's CDN serves `/static/*`
  and the manifest with long cache headers.
- **Indexed query paths** — composite `(user_id, name)` on
  medications, `(user_id, taken_at desc)` on dose_logs, dedicated
  per-user index on oauth_accounts; no full-table scans on the
  hot pages.
- **Reminders cron** — overdue-medication query uses a single
  GROUP BY for last-dose lookup (was a per-row correlated subquery
  before the audit pass).
- **`/api/health`** — no DB hit; cheap enough for high-frequency
  uptime probes (`Cache-Control: no-store`).

## Database design

See [`docs/database.md`](docs/database.md) for the full table-by-table
reference, indexes, and migration workflow. Quick summary:

| Table                                                | Purpose                                                |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `users`, `sessions`, `oauth_accounts`                | Auth core                                              |
| `email_verification_tokens`, `password_reset_tokens` | Email flows (hashed tokens)                            |
| `medications`                                        | User-owned; colours, pattern, schedule, `archived_at`  |
| `dose_logs`                                          | One row per logged dose; `status` taken/skipped/missed |
| `audit_logs`                                         | Append-only JSONB diff log                             |
| `user_preferences`                                   | Per-user UI/format/reminder settings                   |
| `rate_limits`                                        | Sliding-window login + reset rate limit                |
| `push_subscriptions`                                 | Web Push endpoints                                     |
| `reminder_events`                                    | Idempotency key for cron dispatch                      |
| `reauth_tokens`                                      | Sensitive-action re-auth audit                         |

## Testing strategy

- **Unit tests** — Vitest. Coverage scoped to `src/lib/**` so
  routes (which need E2E) don't inflate the denominator. Provider:
  v8. Reporters: text, html, lcov, json-summary.
- **Coverage thresholds** — baseline measured at end of Phase 3,
  thresholds set just below to fail CI on regression.
- **E2E** — Playwright. Real product journeys for auth,
  medication lifecycle, dose logging, analytics, history filters,
  exports, and an axe-core accessibility scan. A deterministic
  seed (`scripts/seed-e2e.ts`) creates a fixed user, three
  medications, and 14 days of synthetic history; tests reuse the
  seeded session via Playwright `storageState`. Teardown removes
  any user under the `@e2e.medtracker.test` domain.
- **CI** — GitHub Actions: install → check → lint → format-check
  → test (with coverage upload) → secret scan (Gitleaks) →
  `npm audit` → build → optional E2E job (gated on the `RUN_E2E`
  repo variable and the `E2E_DATABASE_URL` secret). See
  `.github/workflows/ci.yml`.

```bash
npm test                # unit tests
npm run test:coverage   # unit tests with v8 coverage
npm run test:e2e        # Playwright (requires dev server + DB)
```

### Running E2E tests locally

E2E tests need a real database. Use a separate Neon branch (or
local Postgres) so the suite can seed and tear down without
touching personal data.

```bash
# 1. Point at a test database. Either DATABASE_URL or
#    E2E_DATABASE_URL works; the seed script prefers the latter.
export E2E_DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"

# 2. Apply the schema once.
npm run db:push

# 3. Install Chromium for Playwright (one-off).
npm run playwright:install

# 4. Run the suite. Global setup re-seeds the user automatically;
#    you don't need to run seed:e2e by hand.
npm run test:e2e

# 5. Inspect the HTML report after a failure.
npx playwright show-report

# Single file:
npx playwright test tests/e2e/dose-logging.test.ts
```

The deterministic seed user is `e2e-seeded@e2e.medtracker.test`
(password `e2e-medtracker-2026`). Both values are intentionally
fixed; the account only ever exists in test databases under a
domain that cannot resolve to a real mailbox.

## Local development

```bash
git clone https://github.com/JWhite212/medication-tracker.git
cd medication-tracker
npm install
cp .env.example .env    # fill in DATABASE_URL at minimum

npm run db:migrate      # apply Drizzle migrations
npm run dev             # start dev server on :5173
```

Other handy commands:

| Command               | Purpose                          |
| --------------------- | -------------------------------- |
| `npm run check`       | Type-check (svelte-check)        |
| `npm run lint`        | ESLint                           |
| `npm run format`      | Prettier --write                 |
| `npm run db:generate` | Diff schema → new migration file |
| `npm run db:studio`   | Open Drizzle Studio              |

A `husky` pre-commit hook runs `lint-staged` (ESLint + Prettier on
the staged files) before every commit.

## Environment variables

The full annotated list lives in [`.env.example`](.env.example).
Required: `DATABASE_URL`. Everything else is optional and disables
the corresponding feature when unset (OAuth, email, push,
interactions). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for
the production setup runbook.

## What I learned

The long version is in [`docs/case-study.md`](docs/case-study.md) §7.
Six honest takeaways:

1. **Server-first removes a class of bugs.** SvelteKit form actions
   collapse "client state, then API call, then re-fetch, then update
   UI" into one round trip. Fewer states, fewer race conditions.
2. **Drizzle's thinness is a feature.** When a query is just SQL with
   typed bindings, you can read it. Heavier ORMs hide the actual
   query plan and make perf work harder.
3. **The Neon HTTP driver doesn't support transactions.** A real
   constraint, not a paper one — inventory decrements after a dose
   log are eventually consistent. Documented as a known limitation.
4. **Idempotency keys earn their keep at the cron boundary.**
   `reminder_events.dedupe_key` made the cron handler safe to retry
   with no effort. Cheaper than locks.
5. **The dose-status column should have been there from day one.**
   I shipped `quantity: 0 + notes: "Skipped"` for skipped doses
   (Phase 1 plan). It worked. It also distorted analytics counts
   until I added a real `status` enum. Schema choices outlive code.
6. **Coverage thresholds work as regression floors, not goals.**
   Measure the current floor, set the gate just below, and let the
   number rise organically. Setting "80% target" before there's a
   baseline only produces theatre.

## Known limitations

- **End-to-end tests on CI** are gated on a `RUN_E2E` repo variable
  plus an `E2E_DATABASE_URL` secret pointing at a Neon test branch.
  Until both are set the suite still runs locally (`npm run test:e2e`)
  but the CI job is a no-op.
- **Drug interactions** require a deliberate `INTERACTIONS_ENABLED=true`
  to turn on, and even then the warning panel is labelled
  "Experimental" — false positives are expected.
- **Inventory concurrency** — the Neon HTTP driver does not support
  transactions, so two dose-log writes that arrive within the same
  millisecond can race the inventory decrement. Acceptable for a
  single-user app; flagged below as a follow-up for a multi-user
  deployment.

## Known follow-ups

Honest list of audit findings deliberately deferred under a
conservative-risk policy, and the resolutions of items a later pass
closed out:

- **Inventory concurrency** (open) — versioned updates / optimistic
  CC for high-traffic deployments (single-user is unaffected).
- **CSP `style-src`** (verified, must keep `'unsafe-inline'`) — the
  app renders dynamic style _attributes_ everywhere: chart bar
  heights (`height: {pct}%`), medication colour dots, staggered
  animation delays, and the accent theme via `style:--color-accent`.
  CSP hashes only cover `<style>` elements, not attributes, so
  removing `'unsafe-inline'` would break those surfaces for no
  practical gain (script-src remains strict).
- **Argon2 parameter versioning** (done) — Argon2's PHC hash format
  already embeds its parameters, so `needsRehash()` parses and
  compares them against the current cost constants and the login
  action transparently re-hashes on the next successful sign-in.
- **Log-page filter UX** (done) — filters are a native GET `<form>`:
  they work without JavaScript, and JS enhances them with
  auto-submit-on-change plus a debounced notes search.
- **`sharp` dependency** (resolved) — now a first-class dev
  dependency consumed by `scripts/optimize-images.mjs`, which
  produces the WebP illustrations shipped in the client bundle.
- **Lighthouse CI** (done) — `.github/workflows/lighthouse.yml`
  audits the production landing and login pages weekly and on
  demand, median of 3 runs.

## Roadmap

Tracked across implementation phases, with the source plan in
[`.claude/PRPs/plans/improvements-broad.plan.md`](.claude/PRPs/plans/improvements-broad.plan.md):

- **Phase 1 hardening** — ownership guards, status column, reminder
  dedup, secure cookies, TOTP encryption, re-auth gate, session
  invalidation, CSV/PDF safety. **Done.**
- **Phase 2 repo quality** — ESLint, Prettier, CI, coverage,
  Drizzle scripts, env documentation. **Done.**
- **Phase 3 tests** — unit tests for crypto, TOTP, CSV, analytics,
  interactions; coverage thresholds. **Done.**
- **Phase 4 polish** — keyboard shortcuts, interactions feature
  flag, medical disclaimer (4a). README, ADRs, case study (4b).
  Demo seed account (4c). Multi-row schedule refactor (4d).
  Accessibility WCAG 2.2 AA pass. PWA installability + push.
  **Done.**
- **Phase 5 audit** — security headers, password-change session
  rotation, query-param validation, schema indexes + `archived_at`,
  shared hashToken util, reminders N+1 fix, `/api/health`, API
  rate-limiting, email-verify rate limit, badge contrast, heatmap
  a11y, reorder a11y, pending-state on delete, README, CHANGELOG,
  CONTRIBUTING, SECURITY, deployment guide, husky, CI hardening.
  **Done.**

## Dependency policy

The project deliberately tracks recent versions of SvelteKit,
Svelte 5, Tailwind v4, Vite, and Vitest — but values stability
over bleeding edge. The rule of thumb is to wait one minor after
a release so the ecosystem (adapters, lint plugins, type
definitions) has time to catch up.

Pinning strategy:

- **Dev dependencies** — caret ranges (`^x.y.z`); minor and patch
  updates roll forward automatically when `npm install` runs.
- **Security-critical runtime** — tilde (`~x.y.z`) or exact pin
  for `lucia`, `@node-rs/argon2`, `web-push`, `resend`, and
  `@neondatabase/serverless`. Patch updates are reviewed
  manually rather than absorbed by `^` resolution.

Cadence:

- Dependencies are reviewed quarterly. `npm outdated` triages
  what has drifted; updates are split by category.
- Major-version bumps require CI green plus a manual E2E smoke
  run before merge.
- `npm audit` runs weekly; high or critical advisories are
  patched within seven days or explicitly deferred with a note.

See [`docs/dependency-policy.md`](docs/dependency-policy.md) for
the full policy, including the upgrade process, security
advisory handling, and the reasoning behind each floor version.

### Floor versions

| Dependency | Floor version | Notes                             |
| ---------- | ------------- | --------------------------------- |
| Node       | 22            | LTS; matches CI and Vercel target |
| Svelte     | 5.55          | Runes API stable                  |
| SvelteKit  | 2.57          | Form actions + server hooks       |
| Vite       | 8.0           | Tracking current major            |
| Tailwind   | 4.2           | Vite plugin variant               |
| TypeScript | 6.0           | Strict mode on                    |
| Vitest     | 4.1           | v8 coverage provider              |

## License

[MIT](LICENSE)
