# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Per-medication notification overrides — `notifications_enabled` kill switch plus per-channel overdue/low-inventory overrides on each medication, `NULL` meaning "inherit the account-wide `user_preferences` toggle" (`src/lib/server/notifications/resolve.ts`).
- Bounded repeat-until-acted reminder cadence — the first overdue reminder can be delayed by `notifyOffsetMinutes` past the scheduled slot, then re-notifies every `notifyRepeatEveryMinutes` up to `notifyMaxRepeats` times. The re-notification ordinal is derived from elapsed time and capped, not counted in a table, so it stays bounded by design (see [ADR 0005](docs/adr/0005-reminder-deduplication.md)).
- `reminder_events` retention purge — rows older than 90 days are deleted on every cron tick (`purgeExpiredReminderEvents`), now that a slot can mint more than one row.

### Changed

- Audit branches (`audit/*`) are landing repository hygiene, accessibility follow-ups, and developer-experience improvements.

### Fixed

- The Date Format setting now does something. `user_preferences.dateFormat` had been write-only since the original schema — stored, validated at all three doors, rendered as a `<select>`, and read by no formatter — so changing it changed no date anywhere in the app. A new `formatUserDate` (`src/lib/utils/time.ts`) is its single reader, and the Log day headings, medication inventory-event history, PDF report and Settings → Security session expiry now follow it. The preference selects a locale rather than a literal pattern, so the `DD/MM/YYYY` default renders exactly what those surfaces rendered before and no existing account sees its dates change. Date _keys_ — the day keys in analytics/schedule/log/medications and the CSV date cell, which the importer re-reads as strict `YYYY-MM-DD` — deliberately keep their hardcoded ISO format. Two latent bugs fell out with it: the inventory-event history had been rendering in the browser's timezone rather than the profile's, and the session-expiry line used a bare `toLocaleDateString()`.
- Dark palette raised to WCAG AA. `--color-text-secondary` (3.63:1 → 7.21:1) and `--color-text-muted` (2.64:1 → 4.53:1) now clear 4.5:1 on all six surfaces including the glass composites; a new `--color-danger-ink` (`#f98686`, 5.24:1) carries the 26 files that use danger as text, while the `#ef4444` fill is unchanged; a new `--color-border-strong` gives form inputs a 3:1 boundary (WCAG 1.4.11), which the 1.33:1 decorative hairline never provided.
- The accent splits into two tokens. `--color-accent` (`#4f46e5`) is the fill, and white on it now measures 6.29:1 rather than 4.47:1; `--color-accent-ink` is the text and border variant, derived per user from the stored accent so it tints with it (`#4f46e5` → `#9792f0`, 4.59:1) rather than being frozen at one hue. No single value satisfies both roles — the fill scores 1.99:1 as text. The stored default moves to `#4f46e5` with a backfill, because the layout writes it inline and an inline style beats the stylesheet.
- Tinted chips (`bg-danger/20 text-danger-ink` and the like) are measured against the backdrop they actually composite onto rather than the nearest opaque surface, which raised `--color-info` to `#a5a8f8` (4.71:1 on a hovered card) and `--color-danger-ink` to `#f98686` (5.00:1 in the same place).
- `@media (prefers-contrast: more)` raises contrast again. Its overrides pre-dated the AA base and had become downgrades — `--color-text-muted` measured 4.02:1 against the base's 4.53:1.
- Toast notifications render outside the dashboard. `<Toast />` is mounted once in the app layout; it was previously mounted only on `/dashboard`, so dose deletion on `/log` and the push toggles in settings produced no visible confirmation at all.
- Compact display density no longer pushes page content under the fixed mobile header — the rule used the `padding` shorthand, which reset `padding-top`.
- The activity heatmap honours the in-app "Reduce motion" setting, not just the OS one. The rule was compiled away as an unused selector because it targets an ancestor from inside a scoped `<style>` block.
- Heatmap colours, the Heatmap tooltip, and thirteen hardcoded `text-white` foregrounds now come from theme tokens.
- Native checkboxes, radios, scrollbars and date-picker glyphs render dark via `color-scheme`, instead of as bright white OS widgets on a near-black page.

## [0.4.0] — Phase 4: polish, scheduling, demo, docs

### Added

- `medication_schedules` table as the canonical source of dose timing; analytics, dashboard, and refill forecasting now read from it.
- Analytics polish: schedule overlay on the dose-timing chart, variance indicators, status breakdown bar, and deterministic insights card driven by `buildInsights` in `src/lib/server/analytics.ts`.
- Refill forecast surface on the dashboard, plus per-medication sparklines on the medications list (powered by `Sparkline.svelte` and `buildSparklineShape`).
- Standardised `EmptyState.svelte` component wired into the log and medications pages.
- Log page filters (medication, status, date range, side-effect search).
- Demo seed account (`demo@medtracker.app`) populated via `npm run seed:demo`, surfaced through a "Try the demo" CTA.
- Architecture Decision Records under `docs/adr/` and a portfolio case study.
- Keyboard shortcuts panel relocated to the dashboard, behind an interactions feature flag.
- Medical disclaimer copy across surfaces touching dose data.

### Changed

- README rewritten in place with screenshots, architecture diagram, and roadmap.
- `src/lib/server/inventory.ts` is now the single source of truth for daily-rate selection — schedules first, legacy columns next, 30-day history for PRN — and owns severity classification (`critical ≤3d`, `warning ≤7d`, `watch ≤14d`).
- `scheduleType` / `scheduleIntervalHours` columns flagged DEPRECATED in `schema.ts` while still populated for backwards compatibility.

### Fixed

- "Days until refill" now prefers schedule rate over historical average for `scheduleType === 'scheduled'`.
- Medication form accepts empty `scheduleIntervalHours` in non-interval modes.
- Distribution chart heights resolve correctly inside flex containers (column wrapper given explicit height, `justify-end` on the column).
- A11y follow-ups on medication-style helpers — readable text on pills, theme-token hover states, contrast-aware Quick Log overlay.
- PR-feedback round on analytics and app polish: correctness, types, and tests.

## [0.3.0] — Phase 3: test coverage

### Added

- Unit tests for crypto, TOTP, CSV export, and analytics modules.
- Coverage thresholds enforced via `vitest` (regression-only baseline).

### Fixed

- Pinned TOTP test clock to deterministic time.
- Mocked `db` import in CSV tests so DB-touching tests can run without a live connection.
- Placeholder `DATABASE_URL` injected during CI build to unblock SvelteKit's prerender step.

## [0.2.0] — Phase 2: repo quality

### Added

- ESLint flat config with `typescript-eslint` and `eslint-plugin-svelte`.
- Prettier with `prettier-plugin-svelte` and `prettier-plugin-tailwindcss`; `format` and `format:check` scripts.
- GitHub Actions CI workflow: install → check → lint → format:check → test (with coverage) → build.
- Drizzle migration scripts: `db:generate`, `db:migrate`, `db:push`, `db:studio` (file-based migrations).
- `.git-blame-ignore-revs` so the formatting baseline doesn't pollute `git blame`.
- Coverage reporting via `@vitest/coverage-v8` (no thresholds yet — collected as baseline).

### Changed

- `.env.example` completed with `EMAIL_FROM`, `PUBLIC_BASE_URL`, and inline comments on every entry.
- Whole-repo Prettier baseline applied in a single style commit.

### Fixed

- TypeScript errors flagged by CI's stricter check.

## [0.1.0] — Phase 1: hardening

### Added

- `dose_logs.status` column (default `'taken'`); skipped doses backfilled from legacy `quantity=0 AND notes='Skipped'` rows.
- `reminder_events` table with unique `dedupe_key` to prevent duplicate reminder sends.
- `reauth_tokens` table backing a server-side recent-reauth gate.
- AES-256-GCM helper at `src/lib/server/auth/crypto.ts` keyed by `ENCRYPTION_KEY`.
- One-shot migration script `scripts/encrypt-totp-secrets.ts` to rotate plaintext TOTP secrets.
- `requireRecentReauth(userId)` helper, applied to enable/disable 2FA, change password, delete account, full export, and revoke sessions.
- `formatUserTime(date, tz, timeFormat)` shared formatter used across dashboard, timeline, history, analytics, CSV, PDF, and email surfaces (en-GB default).

### Changed

- Analytics filters by `status='taken'` and now exposes `takenDoseEvents`, `takenQuantity`, `skippedCount`, `missedCount`, `adherencePercent` (capped at 100), and `overusePercent`.
- `getLastDosePerMedication` filters by `status='taken'`.
- 2FA reauth flow now works for OAuth users; PRN doses included in status totals.
- TOTP codes accepted with stripped whitespace for paste-friendly entry.

### Fixed

- Ownership guard helper applied to `logDose` / `logSkippedDose` so cross-user mutations are rejected.
- Sessions invalidated after password reset confirmation.

### Security

- `secure: !dev` set on OAuth state, Google PKCE verifier, and pending-2FA cookies.
- TOTP secrets encrypted at rest (AES-256-GCM); legacy plaintext lazy-decrypted on first verify.
- CSV export escapes formula-injection prefixes (`= + - @`), newlines, CRLF, and quotes.
- PDF export hardened with header (user, range, timezone), medication summary, dose log, adherence, side-effect summary, generated-at timestamp, and disclaimer.
- OAuth account-takeover vulnerability closed (verified-email gating).

## [0.0.1] — Initial scaffold

### Added

- SvelteKit (Svelte 5 runes) app skeleton with Drizzle ORM on Neon Postgres.
- Lucia v3 session-based authentication with email/password and Google OAuth.
- Core medication tracker surfaces: medications CRUD, dose logging, history, dashboard, analytics.
- PWA installability and Web Push notifications (VAPID).
- WCAG 2.2 AA accessibility pass on core flows.
- CSV and PDF export of dose history.
- Smart reminders via Vercel Cron.
- Password reset flow with secure-token verification.
- 2FA (TOTP) enrolment and verification.
- Onboarding welcome flow, My Day timeline, side-effect logging, dose-edit modal.
- CSP headers, breached-password check via HIBP, baseline rate limiting.
- Brand assets (vector SVGs), inline SVG nav icons, dark-mode-first Tailwind v4 theme.
- Initial CLAUDE.md guidance file for AI-assisted development.

[Unreleased]: https://github.com/JWhite212/medication-tracker/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JWhite212/medication-tracker/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/JWhite212/medication-tracker/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/JWhite212/medication-tracker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JWhite212/medication-tracker/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/JWhite212/medication-tracker/releases/tag/v0.0.1
