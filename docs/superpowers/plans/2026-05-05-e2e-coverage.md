# P1 — Real Playwright End-to-End Coverage

> **Status:** in progress
> **Branch:** `feat/e2e-coverage`
> **Owner:** Jamie

**Goal:** Replace the existing smoke-only Playwright suite with real product-journey tests covering auth, medication lifecycle, dose logging, analytics, history filters, exports, and accessibility, plus a deterministic seed and CI integration.

**Architecture:** A deterministic E2E user is created in a Playwright global-setup step that runs the existing `seed-demo` style logic against a configurable `E2E_DATABASE_URL` (or `DATABASE_URL` if not provided). Each test either reuses the seeded session via Playwright `storageState` or registers a fresh ad-hoc user. Tests that mutate medications/doses use unique names per test so they don't collide. A global teardown deletes any user with `@e2e.medtracker.test`-suffixed email or matching the seeded id, leaving the dev DB clean.

**Tech Stack:** Playwright 1.59, `@axe-core/playwright`, `tsx` for the seed script, existing Drizzle schema and Lucia auth.

---

## File Structure

- Create: `scripts/seed-e2e.ts` (deterministic seed/reset for the E2E user)
- Create: `tests/e2e/global-setup.ts` (runs the seed, captures storageState)
- Create: `tests/e2e/global-teardown.ts` (deletes the E2E user and any `*@e2e.medtracker.test` users)
- Create: `tests/e2e/helpers/auth.ts` (login helper, register helper, unique-email factory)
- Create: `tests/e2e/helpers/selectors.ts` (shared role/text selectors)
- Create: `tests/e2e/helpers/db.ts` (small wrapper to read inventory/dose counts for assertions)
- Create: `tests/e2e/.auth/` (ignored; stores `seeded.json` storageState)
- Create: `tests/e2e/auth.test.ts`
- Create: `tests/e2e/medication-lifecycle.test.ts`
- Create: `tests/e2e/dose-logging.test.ts`
- Create: `tests/e2e/analytics.test.ts`
- Create: `tests/e2e/exports.test.ts`
- Create: `tests/e2e/accessibility.test.ts`
- Modify: `tests/e2e/smoke.test.ts` (keep, but trim duplication)
- Modify: `playwright.config.ts` (projects: setup -> tests, html reporter, trace on first retry, retries=1 in CI)
- Modify: `.github/workflows/ci.yml` (new `e2e` job that installs Chromium and runs `npm run test:e2e`, gated by `E2E_DATABASE_URL` secret)
- Modify: `.gitignore` (add `tests/e2e/.auth/`)
- Modify: `package.json` (add `seed:e2e` and `playwright:install` scripts; add `@axe-core/playwright` dev dep)
- Modify: `README.md` (Testing section: how to run E2E locally and in CI, env var requirements)

## Task list

### Task 1 - Foundation

- Add `seed-e2e.ts` script that creates a deterministic user (`e2e-seeded@e2e.medtracker.test`) with three medications: `Vitamin D` (interval 24h), `Lisinopril` (fixed_time 08:00), `Ibuprofen` (interval 8h). Idempotent: deletes the user first.
- Add `global-setup.ts`: imports the seed function, runs it, then logs in via the login form on a Playwright page and writes storageState to `tests/e2e/.auth/seeded.json`.
- Add `global-teardown.ts`: deletes the seeded user plus any `*@e2e.medtracker.test` users (catches register tests).
- Update `playwright.config.ts` to wire global setup/teardown, define an authenticated project that reuses storageState, and set retries=1 / trace=on-first-retry / html reporter.
- Add helpers: `auth.ts` (`registerUser`, `login`, `uniqueEmail`), `selectors.ts`, `db.ts`.
- Add `seed:e2e` script and `playwright:install` script. Add `@axe-core/playwright` devDependency.

### Task 2 - `auth.test.ts`

- Register a new user with the disclaimer checkbox; assert redirect to `/dashboard` and that an OnboardingWelcome / "No medications yet" surface is visible.
- Login with the seeded user; assert dashboard heading.
- Wrong password shows the standard error message and stays on `/auth/login`.
- Logged-out access to `/dashboard` redirects to login (kept from smoke).

### Task 3 - `medication-lifecycle.test.ts`

- From medications list, click "Add Medication", fill name/dosage/unit/form/category, choose interval=12h, submit. Assert it appears on the list.
- Add a second medication with fixed_time scheduleMode and one time slot; assert listed.
- Click into the new medication and edit name; assert change reflected on list.
- Archive the medication; assert it moves into the Archived `<details>`.

### Task 4 - `dose-logging.test.ts`

- Use the seeded user. Read inventory for "Vitamin D" before logging.
- Log dose via QuickLogBar (click pill); assert toast text and inventory decremented by 1.
- Skip dose for an overdue medication via the timeline `Skip` button; assert inventory unchanged.
- Edit a logged dose's notes via the modal; reload `/log`; assert note text shown.
- Delete a `taken` dose from the modal; assert inventory restored.
- Delete a `skipped` dose; assert inventory not restored (re-read inventory).

### Task 5 - `analytics.test.ts`

- Visit `/analytics?period=30`, assert "Avg Adherence" stat card shows a percentage and a sparkline `<svg>` is rendered.
- Visit `/log` with the seeded user; apply a status=taken filter; assert URL has `status=taken` and only taken entries are visible.
- Apply a search query that matches no notes; assert the empty-filter EmptyState.

### Task 6 - `exports.test.ts`

- Click "Download Export" on `/settings/data` after switching format to CSV; capture download; assert filename matches `medtracker-report-YYYY-MM-DD.csv` and the body contains the header row `Date,Time,Medication`.
- Best-effort PDF download (skip with `test.skip` if generation is too slow): switch to PDF, trigger, assert download starts and content type / extension is `.pdf`.

### Task 7 - `accessibility.test.ts`

- Use `@axe-core/playwright` to scan: `/auth/login`, `/auth/register`, `/dashboard`, `/log`, `/medications`, `/analytics` (last four with seeded session). Fail on serious/critical only. Log violation summary to the report.

### Task 8 - CI wiring

- Add a `e2e` job to `.github/workflows/ci.yml` that runs after `validate`. Steps: checkout, setup-node, `npm ci`, `npx playwright install --with-deps chromium`, `npm run seed:e2e`, `npm run test:e2e`. Gate on `secrets.E2E_DATABASE_URL` being non-empty (`if:` clause); if absent, the job is skipped with a reason.
- Persist `playwright-report/` as an artifact on failure.

### Task 9 - README

- Add a "Running E2E tests" subsection under Testing: env var (`E2E_DATABASE_URL`), `npm run seed:e2e`, `npm run test:e2e`, single-file invocation, `npx playwright show-report`. Note the deterministic seed user credentials are intentionally fixed.

### Task 10 - Verification gauntlet

- `npm run check`, `npm run lint`, `npm run format:check`, `npm test`, `npm run build`. Document which steps a real DB would be needed for. Open PR.

## Notes / risks

- The dev DB is a real Neon DB; the teardown step removes only e2e-suffixed accounts so Jamie's personal data is untouched. The seed user uses `@e2e.medtracker.test` which cannot match a real domain.
- CI needs a separate Neon test branch (`E2E_DATABASE_URL`). For now, the job is gated; without the secret, CI behaves identically to today. The README documents how to set it up.
- `2FA`-enabled login is not exercised because the seeded user has it disabled; a follow-up plan can add a TOTP test that uses `@oslojs/otp` to compute codes.
