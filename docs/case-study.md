# MedTracker — Case Study

A full-stack medication tracking application built solo, designed
around fast dose logging, accurate adherence analytics, and honest
medical safety. This document is the version I'd send a recruiter
who asked "tell me about a project you're proud of".

- **Live demo**: https://medication-tracker-jw.vercel.app
- **Repository**: https://github.com/JWhite212/medication-tracker
- **Stack**: SvelteKit 2 / Svelte 5 (runes), TypeScript, Drizzle ORM,
  Postgres (Neon), Tailwind v4, Lucia v3, Argon2id, Web Push, Resend
- **Status**: Personal use + portfolio piece. Hardening, testing,
  CI, and documentation completed across four review-driven phases.

## 1. Problem

People who track medications today juggle pill organisers, sticky
notes, screenshots from one app, exports from another, and the
calendar reminder that didn't fire. The good apps in the space are
either tied to a single insurance ecosystem, paywalled, or bloated
with social features. I wanted to build something I'd actually use:
log a dose with one tap, see at a glance when each pill is next
due, and export a clean PDF for a doctor's appointment.

## 2. Solution

A server-first SvelteKit app with:

- **Quick log**: a single form action per medication, optimistically
  updated, audited.
- **Live timers**: per-medication "last taken" + "next due"
  countdowns recomputed every minute, with a `visibilitychange`
  catch-up so the numbers stay honest after the tab sleeps.
- **Adherence analytics**: per-day / per-medication rollups that
  filter to actual taken doses (skipped/missed are tracked
  separately). Adherence caps at 100 % and the over-100 overflow
  surfaces as a separate "overuse" metric.
- **Reminders**: opt-in email and Web Push, dispatched by a Vercel
  cron, deduplicated by a per-slot dedupe key so the user can't be
  spammed for the same overdue dose.
- **Exports**: PDF (with disclaimer + side-effect summary) or CSV,
  with formula-injection-safe escaping.

## 3. Technical challenges

### Authentication and ownership

Sessions live in Postgres via Lucia v3, password hashing is Argon2id,
TOTP secrets are encrypted at rest with AES-256-GCM. Every dose-log
mutation runs an explicit ownership check on the medication ID —
the Phase 1 review found a real cross-user dose-injection vector and
the fix is now an `assertMedicationBelongsToUser()` guard called
from `logDose` and `logSkippedDose`.

### Re-authentication for sensitive actions

Changing a password, toggling 2FA, or deleting an account requires
a fresh password confirmation. The verification is recorded in a
`reauth_tokens` table that doubles as an audit trail and provides
the primitive for cross-form 5-minute reauth windows when we need
them.

### Timezone-safe scheduling

All timestamps are stored UTC; UI rendering, the "due in" timers,
and the heatmap day-buckets all respect the user's IANA timezone.
Time formatting is centralised in `formatUserTime(date, tz, '12h'
|'24h')` so exports, emails, and on-screen times all agree.

### Idempotent notifications

The reminder cron writes a row to `reminder_events` with a unique
`dedupe_key` (`userId:medicationId:type:nextDueAt`) before sending.
A re-run of the cron can't double-send. See ADR 0005.

### Drug interaction checking — handled honestly

The app calls openFDA for an experimental interaction notice when
adding a new medication. The feature is feature-flagged
(`INTERACTIONS_ENABLED`), surrounded by an `AbortController`
timeout, cached for an hour, and labelled "Experimental — may miss
interactions and may produce false positives". Treating the feature
as advisory rather than authoritative is the difference between a
helpful nudge and a liability.

## 4. Architecture

```
+-------------------+
|  Browser / PWA    | <-- service-worker for offline shell + push
+---------+---------+
          |
          | HTTP, form POST/GET
          v
+---------+---------+
|  SvelteKit edge   |
|  (Vercel)         |
|  - Loaders        |
|  - Form actions   |
|  - API endpoints  |
|  - Cron handlers  |
+---------+---------+
          |
          | Drizzle ORM
          v
+---------+---------+        +-----------------------+
| Postgres (Neon)   | <----  | Resend (transactional |
|                   |        | email)                |
| users, sessions,  |        +-----------------------+
| medications,      |
| dose_logs,        |        +-----------------------+
| reminder_events,  | <----  | OpenFDA (drug labels) |
| reauth_tokens,    |        | feature-flagged       |
| audit_logs ...    |        +-----------------------+
+-------------------+
```

Notable design choices captured in the ADRs:

- [0001 SvelteKit](./adr/0001-sveltekit.md) over Next/Remix.
- [0002 Drizzle + Neon](./adr/0002-drizzle-postgres.md) over Prisma /
  Kysely / SQLite.
- [0003 Server-first form actions](./adr/0003-server-first-form-actions.md)
  over a JSON API.
- [0004 Lucia auth](./adr/0004-lucia-auth.md) over a managed provider.
- [0005 Reminder dedupe](./adr/0005-reminder-deduplication.md).

## 5. Quality

| Discipline      | What's in place                                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Type safety     | TypeScript strict mode, `svelte-check` in CI                                                                                            |
| Linting         | ESLint 10 flat config + Prettier 3 + Tailwind plugin                                                                                    |
| Unit tests      | Vitest with v8 coverage, 121 tests at time of writing                                                                                   |
| CI              | GitHub Actions: install → check → lint → format-check → test (with coverage upload) → build                                             |
| Database        | File-based Drizzle migrations, schema changes reviewed in PR                                                                            |
| Security review | Phase 1 hardening: ownership guards, AES-256-GCM TOTP secrets, secure-cookie posture, password-reset session invalidation, re-auth gate |
| Accessibility   | WCAG 2.2 AA pass, focus traps in modals, semantic empty states, reduced-motion preference honoured                                      |

## 6. What I would improve next

- **Test coverage** — server unit tests for `doses.ts` and the
  reauth helper need a test database; that infrastructure is the
  next CI investment.
- **End-to-end tests** — Playwright journey + axe-core a11y audit.
- **Native shell** — wrap the PWA in Capacitor for App Store /
  Play Store distribution.
- **Doctor-share** — read-only signed URL for sharing the last 30
  days of dose history without giving someone account access.

## 7. What I learned

- Server-first + form actions removes a class of bugs at the cost
  of a less flashy SPA feel. Worth it for anything mutation-heavy.
- The cheapest way to get an honest sense of code quality is to
  add CI. Pre-existing TypeScript errors and a missing
  `DATABASE_URL` placeholder both surfaced the day CI went live —
  before that, "it works on my machine" was load-bearing.
- Coverage thresholds are most useful as **regression-only floors**
  set at the actual measured baseline. Aspirational targets
  incentivise tests of the wrong shape.
- A small, correct schema beats a clever ORM. Drizzle's plain SQL
  migrations let me hand-write the legacy `quantity=0/notes='Skipped'`
  → `status='skipped'` backfill exactly the way I'd want a senior
  engineer to write it.
