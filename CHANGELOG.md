# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Sign-in is bounded per account, not just per address.** The browser login form throttled by IP alone, so an attacker with a pool of addresses had an unlimited guessing budget against any known email — while `/api/v1/auth/login` had bounded the account all along. Both doors now spend the same two budgets. The account budget is checked before the password and charged **only when the attempt fails**, so an attacker still gets five wrong guesses per window and a correct password costs nothing: the API door's previous behaviour of counting every attempt meant anyone who knew an email address could lock its owner out indefinitely, which is now closed too.
- **Sign in with Apple is rate-limited.** It had no limiter of any kind — the only credential door in the app that was entirely unbounded, and one that creates an account for any valid identity.
- **The browser second factor is a second factor again.** `/auth/2fa` trusted a `pending_2fa` cookie holding a raw user id. `httpOnly` stops JavaScript reading a cookie; it does not stop an attacker setting one on their own request — so the password could be skipped entirely: set the cookie to a victim's id, submit a valid six-digit code, receive a full session. The user id is not a secret and was never meant to be one; it ships in every `/api/v1` export. The cookie now carries the same HMAC-signed, single-use, five-minute claim that `/api/v1/auth/2fa` has always consumed. **A user sitting on the 2FA screen when this deploys is redirected to sign in again** — the cookie's lifetime is five minutes, so the window is small.
- **A code from an abandoned 2FA enrolment no longer logs anyone in.** `setupTwoFactor` writes the TOTP secret when it renders the QR code, before the user confirms, and nothing cleared it if they walked away — so an account with 2FA switched _off_ could be holding a live credential, one that had been displayed on screen. Both session-minting doors now require that 2FA is actually enabled; the enrolment door keeps the unchecked path, because it is what turns the flag on.
- **Password re-confirmation is bounded.** `confirmReauth` guards six sensitive actions and none of its five call sites limited anything, so anyone holding a stolen session cookie could guess the account password without limit and without leaving a failed-login audit row — each guess burning a full Argon2 verify. The limit now lives in `confirmReauth` itself, per account, and is counted before the verify so a refused attempt costs no CPU.
- **A reauth token can only be spent once.** Redeeming one was a read followed by a separate write, so two concurrent redemptions both succeeded — one password entry authorising two destructive actions. It is now a single conditional update, the same compare-and-set the TOTP replay guard uses.
- **`ENCRYPTION_KEY` is now validated at boot.** Its absence used to surface only after a password had been accepted, mid-login, for 2FA users alone — the same silent shape as the `CRON_SECRET` outage that ran undetected for four months. `CRON_SECRET` deliberately stays out of the boot check: without it only reminders stop, and refusing to start the whole app over a background job trades a degraded feature for a total outage.
- **A deploy that cannot boot now fails the build instead of shipping.** Making a variable boot-required is a change to the deployment contract, and nothing verified that contract against the environment being deployed into — so adding `ENCRYPTION_KEY` to it produced a green build, a promoted deploy, and 500s on every route including `/favicon.ico`, because `env.ts` throws at module load and the function dies before routing. `scripts/vercel-build.mjs` now evaluates the same rules against `process.env` first, before the schema push, and aborts with the variable names and the environment to set them in. The rules have exactly one statement — `src/lib/server/env-contract.js`, read by both the boot check and the build check — so a variable can no longer be required in one place and unchecked in the other. Enforced for Production and Preview builds, mirroring precisely when the server boots with `dev === false`; `vercel dev` and local builds are exempt.

### Added

- Failures now leave a trace. An unexpected server error is recorded once, as a structured line carrying the route, the request method and the user id, and the page shows a short reference the user can quote — previously it produced an untraceable "Internal Error" and a raw stderr line with nothing tying the two together. The reference is random and the message is fixed, so nothing from the exception reaches the browser.
- `POST /api/v1/auth/reauth` — mints a short-lived, single-use password proof for the destructive commands above. Requires an authenticated bearer token. Shares `confirmReauth`'s per-account attempt budget with the browser doors, so the allowance cannot be refreshed by switching transport.
- Per-medication notification overrides — `notifications_enabled` kill switch plus per-channel overdue/low-inventory overrides on each medication, `NULL` meaning "inherit the account-wide `user_preferences` toggle" (`src/lib/server/notifications/resolve.ts`).
- Bounded repeat-until-acted reminder cadence — the first overdue reminder can be delayed by `notifyOffsetMinutes` past the scheduled slot, then re-notifies every `notifyRepeatEveryMinutes` up to `notifyMaxRepeats` times. The re-notification ordinal is derived from elapsed time and capped, not counted in a table, so it stays bounded by design (see [ADR 0005](docs/adr/0005-reminder-deduplication.md)).
- `reminder_events` retention purge — rows older than 90 days are deleted on every cron tick (`purgeExpiredReminderEvents`), now that a slot can mint more than one row.
- Light, dark and system themes. `system` needs no JavaScript — it is a `prefers-color-scheme` block in the stylesheet — while an explicit choice is delivered as a server-rendered `<style>` block scoped to the signed-in app. Existing accounts default to `dark`, so nothing changes for anyone who does not go looking for it. The light palette is authored against measured contrast rather than picked by eye: every foreground clears 4.5:1 on each of the six surfaces it actually renders on, including its own tinted chips, and a unit test asserts both schemes against the real stylesheet. `/auth/*` and the landing page follow the device setting rather than the stored one, which for a shared or signed-out browser is the better answer.

### Changed

- **BREAKING (`/api/v1`):** `wipe_dose_history` and `wipe_archived_medications` now require `{ reauthToken }` in their payload, where before the payload was ignored. Both are irreversible and write no per-row tombstone, and the browser has always demanded a password for them — this door demanded nothing, so a stolen bearer token was sufficient to destroy a user's entire dose history. Mint a token with the new `POST /api/v1/auth/reauth` (`{ password, purpose }`); it is single-use, expires in five minutes and is bound to the command it was minted for. An OAuth-only account has no password to confirm and so cannot use these commands — the position it is already in on the web privacy page.
- Audit branches (`audit/*`) are landing repository hygiene, accessibility follow-ups, and developer-experience improvements.
- Appearance settings save as you change them. Each control posts its own field to its own form action rather than one bulk save, debounced so a settled control produces one request, single-flighted per field so two rapid changes land in order, and rate-limited per user. Without JavaScript each control keeps its own Save button; the accent swatches become real radios, which means the accent can be changed without JavaScript at all for the first time.
- The `/api/v1` `update_preferences` door bounds `heatmapPeriod` to 1–3650, matching the import door. It was unbounded, and the value reaches the activity heatmap's per-day render loop unclamped.

### Fixed

- Quick-logging a dose no longer fails silently. Logging or skipping a medication that had been deleted in another tab spun the button and then did nothing at all — no toast, no error, no row — so the dose looked recorded when it was not. All four dashboard paths now surface the failure.
- Quick-logging from the Medications list refreshes the card. It posted the dose and left "Last taken", the supply-days-left chip, the adherence bar and the 14-day sparkline showing their pre-log values until the next navigation, so the card contradicted the action just taken. It also silently swallowed failures, including network ones.
- Preference changes can no longer lose an audit row. `updatePreferences` read its before-image in a separate query, so two overlapping saves for the same field both diffed against the same stored value and the second change went unlogged — leaving the audit log claiming a value the column did not hold. The before-image now comes from a locking read inside the write itself.
- The Date Format setting now does something. `user_preferences.dateFormat` had been write-only since the original schema — stored, validated at all three doors, rendered as a `<select>`, and read by no formatter — so changing it changed no date anywhere in the app. A new `formatUserDate` (`src/lib/utils/time.ts`) is its single reader, and the Log day headings, medication inventory-event history, PDF report and Settings → Security session expiry now follow it. The two named-month options select a locale rather than a literal pattern, so on the `DD/MM/YYYY` default the dates themselves render as they did before; `YYYY-MM-DD` is assembled from `formatToParts` instead, because a locale is not obliged to emit ISO order and `en-CA` in particular already changed pattern once (ICU 72) — and since this code runs in the viewer's browser, a server-side test could never catch it. Two renderings do change on that default, both deliberate: the inventory-event history drops its day's leading zero (`05 Apr` → `5 Apr`), and its clock switches from a hardcoded 24-hour format to the account's `timeFormat`, so `18:20` reads `6:20 pm` unless 24-hour is selected — that surface had been ignoring the setting. Date _keys_ — the day keys in analytics/schedule/log/medications and the CSV date cell, which the importer re-reads as strict `YYYY-MM-DD` — deliberately keep their hardcoded ISO format. Two latent bugs fell out with it: the inventory-event history had been rendering in the browser's timezone rather than the profile's, and the session-expiry line used a bare `toLocaleDateString()`.
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

[unreleased]: https://github.com/JWhite212/medication-tracker/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/JWhite212/medication-tracker/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/JWhite212/medication-tracker/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/JWhite212/medication-tracker/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/JWhite212/medication-tracker/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/JWhite212/medication-tracker/releases/tag/v0.0.1
