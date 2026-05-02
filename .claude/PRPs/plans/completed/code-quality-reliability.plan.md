# Plan: Code Quality & Reliability

## Summary

Fix the types.ts syntax error, eliminate the N+1 query in reminders, add environment validation at startup, create error boundary pages, add missing unit tests for medication-style.ts, add npm test scripts, and set up Playwright E2E with a smoke test. Builds on the existing 7 test suites.

## User Story

As a developer maintaining MedTracker,
I want reliable error handling, validated environments, and comprehensive tests,
So that regressions are caught early and production failures are graceful.

## Problem → Solution

Types.ts has a syntax error, reminders cron runs N+1 queries, no env validation at startup (crashes with cryptic errors), no error boundaries (users see raw SvelteKit errors), medication-style.ts is untested, no E2E tests, no npm test script → All fixed with proper validation, error handling, and test coverage.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A (from opportunity map Theme C)
- **PRD Phase**: N/A
- **Estimated Files**: 12

---

## UX Design

### Before

```
┌──────────────────────────────────┐
│  Missing env var → cryptic crash │
│  Server error → raw SvelteKit    │
│  500 page with stack trace       │
│  No way to know what broke       │
└──────────────────────────────────┘
```

### After

```
┌──────────────────────────────────┐
│  Missing env var → clear error   │
│  message at startup listing      │
│  which vars are missing          │
│                                  │
│  Server error → branded error    │
│  page: "Something went wrong"    │
│  with link back to dashboard     │
│                                  │
│  404 → "Page not found" with     │
│  navigation back                 │
└──────────────────────────────────┘
```

### Interaction Changes

| Touchpoint       | Before                             | After                                       | Notes                           |
| ---------------- | ---------------------------------- | ------------------------------------------- | ------------------------------- |
| Missing env var  | Crash at first request             | Clear startup error listing missing vars    | Fail-fast at module load        |
| Server 500 error | Raw SvelteKit error page           | Branded error with "Back to dashboard" link | +error.svelte                   |
| 404 page         | Generic SvelteKit 404              | Branded 404 with navigation                 | +error.svelte handles all codes |
| npm test         | Must run `npx vitest run` manually | `npm test` works                            | package.json scripts            |

---

## Mandatory Reading

| Priority | File                                | Lines | Why                                         |
| -------- | ----------------------------------- | ----- | ------------------------------------------- |
| P0       | `src/lib/types.ts`                  | 48-58 | Syntax error to fix — missing closing brace |
| P0       | `src/lib/server/reminders.ts`       | all   | N+1 query to fix                            |
| P0       | `tests/unit/schedule.test.ts`       | 1-30  | Factory function pattern to mirror          |
| P1       | `src/lib/utils/medication-style.ts` | all   | Untested utility to cover                   |
| P1       | `vite.config.ts`                    | all   | Test configuration                          |
| P1       | `src/lib/server/db/index.ts`        | all   | How DATABASE_URL is consumed                |
| P2       | `tests/unit/time.test.ts`           | all   | Test pattern reference                      |
| P2       | `tests/unit/audit.test.ts`          | all   | DB mock pattern                             |

---

## Patterns to Mirror

### TEST_FILE_STRUCTURE

```typescript
// SOURCE: tests/unit/time.test.ts:1-10
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatTimeSince, formatTime } from "$lib/utils/time";

describe("formatTimeSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for < 60s", () => {
    // ...
    expect(formatTimeSince(date)).toBe("just now");
  });
});
```

### TEST_FACTORY_PATTERN

```typescript
// SOURCE: tests/unit/schedule.test.ts:8-27
function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "Test Med",
    // ... all fields with defaults
    ...overrides,
  };
}
```

### DB_MOCK_PATTERN

```typescript
// SOURCE: tests/unit/audit.test.ts:3
vi.mock("$lib/server/db", () => ({ db: {} }));
```

### DRIZZLE_QUERY_PATTERN

```typescript
// SOURCE: src/lib/server/medications.ts:15-30
const rows = await db
  .select({ ... })
  .from(medications)
  .innerJoin(doseLogs, eq(...))
  .where(and(...))
  .groupBy(...);
```

### ERROR_PAGE_PATTERN (SvelteKit convention)

```svelte
<!-- SvelteKit +error.svelte receives page.status and page.error -->
<script>
  import { page } from "$app/stores";
</script>

<h1>{$page.status}</h1><p>{$page.error?.message}</p>
```

---

## Files to Change

| File                                  | Action | Justification                                       |
| ------------------------------------- | ------ | --------------------------------------------------- |
| `src/lib/types.ts`                    | UPDATE | Fix missing closing brace on MedicationWithStats    |
| `src/lib/server/reminders.ts`         | UPDATE | Fix N+1 query with correlated subquery              |
| `src/lib/server/env.ts`               | CREATE | Environment validation module                       |
| `src/hooks.server.ts`                 | UPDATE | Import env validation (fail-fast)                   |
| `src/routes/+error.svelte`            | CREATE | Root error boundary (all non-app routes)            |
| `src/routes/(app)/+error.svelte`      | CREATE | App error boundary (authenticated routes)           |
| `tests/unit/medication-style.test.ts` | CREATE | Tests for getMedicationBackground + PATTERN_OPTIONS |
| `tests/unit/push-validation.test.ts`  | CREATE | Tests for pushSubscriptionSchema origin whitelist   |
| `playwright.config.ts`                | CREATE | Playwright E2E configuration                        |
| `tests/e2e/smoke.test.ts`             | CREATE | Basic E2E smoke test (login page loads)             |
| `package.json`                        | UPDATE | Add test/test:watch/test:e2e scripts                |
| `.env.example`                        | UPDATE | Document which vars are required vs optional        |

## NOT Building

- 100% test coverage (diminishing returns — focus on untested utilities and critical paths)
- Integration tests against real database (requires test DB infrastructure)
- Visual regression tests (separate tooling)
- Performance benchmarks
- CI/CD pipeline changes (Vercel handles this)
- Component tests for all Svelte components (large scope, separate effort)

---

## Step-by-Step Tasks

### Task 1: Fix types.ts Syntax Error

- **ACTION**: Add missing closing brace to `MedicationWithStats` type at line 52
- **IMPLEMENT**: Add `};` after `daysUntilRefill: number | null;` on line 52
- **MIRROR**: Other type definitions in same file (all properly closed)
- **IMPORTS**: None
- **GOTCHA**: Line 53 currently starts `export type MedicationTimingStatus` directly — the `};` must go between lines 52 and 53
- **VALIDATE**: `npx svelte-check` — the types.ts error should disappear

### Task 2: Fix N+1 Query in Reminders

- **ACTION**: Replace the per-medication loop query with a single query using a correlated subquery for last dose
- **IMPLEMENT**:

  ```typescript
  export async function checkOverdueMedications() {
    const medsWithLastDose = await db
      .select({
        medicationId: medications.id,
        medicationName: medications.name,
        scheduleIntervalHours: medications.scheduleIntervalHours,
        userId: medications.userId,
        userEmail: users.email,
        lastTakenAt: sql<Date | null>`(
          SELECT ${doseLogs.takenAt}
          FROM ${doseLogs}
          WHERE ${doseLogs.medicationId} = ${medications.id}
          ORDER BY ${doseLogs.takenAt} DESC
          LIMIT 1
        )`,
      })
      .from(medications)
      .innerJoin(users, eq(medications.userId, users.id))
      .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
      .where(
        and(
          eq(medications.isArchived, false),
          isNotNull(medications.scheduleIntervalHours),
          eq(userPreferences.emailReminders, true),
        ),
      );

    for (const med of medsWithLastDose) {
      if (!med.lastTakenAt) continue;
      const intervalMs = Number(med.scheduleIntervalHours) * 3600000;
      const elapsed = Date.now() - new Date(med.lastTakenAt).getTime();
      if (elapsed > intervalMs) {
        await sendReminderEmail(
          med.userEmail,
          med.medicationName,
          formatTimeSince(new Date(med.lastTakenAt)),
        );
        try {
          await sendPushNotification(med.userId, {
            title: `${med.medicationName} overdue`,
            body: `Last taken ${formatTimeSince(new Date(med.lastTakenAt))} ago`,
            url: "/dashboard",
            tag: `overdue-${med.medicationId}`,
          });
        } catch {}
      }
    }
  }
  ```

- **MIRROR**: Correlated subquery pattern used in `getMedicationsWithStats` (`src/lib/server/medications.ts`)
- **IMPORTS**: Same imports as current file — no changes needed
- **GOTCHA**: The correlated subquery runs inside the DB engine, not in JS. The `lastTakenAt` will be `null` for medications with no doses (the `continue` handles this). Ensure `sql<Date | null>` type annotation is correct for Drizzle.
- **VALIDATE**: The function should produce identical results but with 1 query instead of N+1. Type-check clean.

### Task 3: Add Environment Validation

- **ACTION**: Create `src/lib/server/env.ts` that validates required env vars at import time
- **IMPLEMENT**:

  ```typescript
  import { env } from "$env/dynamic/private";

  const required = ["DATABASE_URL"] as const;

  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Check .env.example for the full list.`,
    );
  }

  export const validatedEnv = {
    DATABASE_URL: env.DATABASE_URL!,
    hasOAuth: !!(env.GOOGLE_CLIENT_ID || env.GITHUB_CLIENT_ID),
    hasEmail: !!env.RESEND_API_KEY,
    hasPush: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
  };
  ```

- **MIRROR**: Existing `$env/dynamic/private` import pattern
- **IMPORTS**: `$env/dynamic/private`
- **GOTCHA**: Don't make OAuth/email/push required — they're optional features. Only `DATABASE_URL` is truly required. Import this in `hooks.server.ts` to trigger validation at startup.
- **VALIDATE**: Remove `DATABASE_URL` from `.env` temporarily — server should fail with clear message.

### Task 4: Create Error Boundary Pages

- **ACTION**: Create `src/routes/+error.svelte` (root) and `src/routes/(app)/+error.svelte` (app)
- **IMPLEMENT**:
  Root error page (`src/routes/+error.svelte`):
  ```svelte
  <script>
    import { page } from "$app/stores";
  </script>

  <svelte:head>
    <title>Error — MedTracker</title>
  </svelte:head>
  <div class="bg-surface flex min-h-screen items-center justify-center px-4">
    <div class="text-center">
      <p class="text-accent text-6xl font-bold">{$page.status}</p>
      <h1 class="text-text-primary mt-4 text-xl font-semibold">
        {$page.status === 404 ? "Page not found" : "Something went wrong"}
      </h1>
      <p class="text-text-secondary mt-2">
        {$page.error?.message ?? "An unexpected error occurred."}
      </p>
      <a
        href="/dashboard"
        class="bg-accent text-accent-fg mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90"
      >
        Back to dashboard
      </a>
    </div>
  </div>
  ```
  App error page (`src/routes/(app)/+error.svelte`) — same content but within the app layout (sidebar visible).
- **MIRROR**: Existing page styling (glassmorphism, Tailwind tokens)
- **IMPORTS**: `$app/stores` (page)
- **GOTCHA**: Root +error.svelte catches errors outside the (app) group (auth pages, landing). The (app)/+error.svelte catches errors within the authenticated layout — it renders inside the sidebar. Don't use `$page.error.message` in production if it could leak stack traces — SvelteKit sanitizes by default in production mode.
- **VALIDATE**: Navigate to `/nonexistent-route` — should show branded 404. Throw an error in a load function — should show branded 500.

### Task 5: Add medication-style.ts Unit Tests

- **ACTION**: Create `tests/unit/medication-style.test.ts`
- **IMPLEMENT**:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { getMedicationBackground, PATTERN_OPTIONS } from "$lib/utils/medication-style";

  describe("PATTERN_OPTIONS", () => {
    it("has 8 pattern choices", () => {
      expect(PATTERN_OPTIONS).toHaveLength(8);
    });
    it("each has id and name", () => {
      for (const opt of PATTERN_OPTIONS) {
        expect(opt.id).toBeTruthy();
        expect(opt.name).toBeTruthy();
      }
    });
  });

  describe("getMedicationBackground", () => {
    it("returns solid colour for single colour", () => {
      expect(getMedicationBackground("#6366f1", null, "solid")).toBe("#6366f1");
    });
    it("returns gradient for two colours with gradient pattern", () => {
      const bg = getMedicationBackground("#6366f1", "#ec4899", "gradient");
      expect(bg).toContain("linear-gradient");
      expect(bg).toContain("#6366f1");
      expect(bg).toContain("#ec4899");
    });
    it("returns split for two colours with split pattern", () => {
      const bg = getMedicationBackground("#6366f1", "#ec4899", "split");
      expect(bg).toContain("linear-gradient");
    });
    it("returns repeating gradient for stripes", () => {
      const bg = getMedicationBackground("#6366f1", "#ec4899", "stripes");
      expect(bg).toContain("repeating-linear-gradient");
    });
    it("returns gradient fallback for geometric patterns when small=true", () => {
      const bg = getMedicationBackground("#6366f1", "#ec4899", "dots", true);
      expect(bg).toContain("linear-gradient");
      expect(bg).not.toContain("radial-gradient");
    });
    it("falls back to primary colour when secondary is null for non-solid", () => {
      expect(getMedicationBackground("#6366f1", null, "gradient")).toBe("#6366f1");
    });
  });
  ```

- **MIRROR**: Test structure from `tests/unit/time.test.ts`
- **IMPORTS**: `vitest`, `$lib/utils/medication-style`
- **GOTCHA**: `getMedicationBackground` returns CSS strings — test with `toContain` not exact match since gradient syntax varies.
- **VALIDATE**: `npx vitest run tests/unit/medication-style.test.ts` — all pass

### Task 6: Add pushSubscriptionSchema Unit Tests

- **ACTION**: Create `tests/unit/push-validation.test.ts`
- **IMPLEMENT**:

  ```typescript
  import { describe, it, expect } from "vitest";
  import { pushSubscriptionSchema } from "$lib/utils/validation";

  describe("pushSubscriptionSchema", () => {
    const valid = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "BNcRdreALRFX", auth: "tBHItJ" },
    };

    it("accepts valid FCM subscription", () => {
      expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true);
    });
    it("accepts Mozilla push endpoint", () => {
      const sub = {
        ...valid,
        endpoint: "https://updates.push.services.mozilla.com/push/v1/abc",
      };
      expect(pushSubscriptionSchema.safeParse(sub).success).toBe(true);
    });
    it("rejects non-push-service URL", () => {
      const sub = { ...valid, endpoint: "https://evil.com/collect" };
      expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
    });
    it("rejects non-URL endpoint", () => {
      const sub = { ...valid, endpoint: "not-a-url" };
      expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
    });
    it("rejects missing keys", () => {
      expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false);
    });
    it("rejects empty p256dh", () => {
      const sub = { ...valid, keys: { p256dh: "", auth: "x" } };
      expect(pushSubscriptionSchema.safeParse(sub).success).toBe(false);
    });
  });
  ```

- **MIRROR**: Test pattern from `tests/unit/validation.test.ts`
- **IMPORTS**: `vitest`, `$lib/utils/validation`
- **GOTCHA**: The `.refine()` for push origins means we need to test each allowed origin.
- **VALIDATE**: `npx vitest run tests/unit/push-validation.test.ts` — all pass

### Task 7: Add npm Test Scripts

- **ACTION**: Add `test`, `test:watch`, and `test:e2e` scripts to `package.json`
- **IMPLEMENT**:
  ```json
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test"
  ```
- **MIRROR**: Existing script naming pattern in package.json
- **IMPORTS**: None
- **GOTCHA**: `vitest run` runs once and exits (CI-friendly). `vitest` without `run` enters watch mode.
- **VALIDATE**: `npm test` runs all unit tests and exits cleanly.

### Task 8: Set Up Playwright E2E with Smoke Test

- **ACTION**: Create `playwright.config.ts` and `tests/e2e/smoke.test.ts`
- **IMPLEMENT**:
  `playwright.config.ts`:

  ```typescript
  import { defineConfig } from "@playwright/test";

  export default defineConfig({
    testDir: "tests/e2e",
    timeout: 30_000,
    retries: 0,
    use: {
      baseURL: "http://localhost:5173",
      screenshot: "only-on-failure",
    },
    webServer: {
      command: "npm run dev",
      port: 5173,
      reuseExistingServer: true,
    },
  });
  ```

  `tests/e2e/smoke.test.ts`:

  ```typescript
  import { test, expect } from "@playwright/test";

  test("login page loads", async ({ page }) => {
    await page.goto("/auth/login");
    await expect(page.locator("h1")).toHaveText("Welcome back");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test("register page loads", async ({ page }) => {
    await page.goto("/auth/register");
    await expect(page.locator("h1")).toHaveText("Create account");
  });

  test("unauthenticated redirect to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/.*\/auth\/login/);
  });
  ```

- **MIRROR**: N/A — first E2E setup
- **IMPORTS**: `@playwright/test`
- **GOTCHA**: `reuseExistingServer: true` prevents restarting if dev server is already running. E2E tests require a running server with a real database.
- **VALIDATE**: `npm run test:e2e` — all 3 tests pass (requires dev server and DATABASE_URL).

### Task 9: Update .env.example Documentation

- **ACTION**: Add comments to `.env.example` indicating which vars are required vs optional
- **IMPLEMENT**: Add section comments above each group
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: Only `DATABASE_URL` is truly required. Everything else gracefully degrades.
- **VALIDATE**: File reads clearly.

---

## Testing Strategy

### Unit Tests

| Test                                   | Input                                  | Expected Output            | Edge Case? |
| -------------------------------------- | -------------------------------------- | -------------------------- | ---------- |
| getMedicationBackground solid          | `("#6366f1", null, "solid")`           | `"#6366f1"`                | No         |
| getMedicationBackground gradient       | `("#6366f1", "#ec4899", "gradient")`   | CSS `linear-gradient(...)` | No         |
| getMedicationBackground null secondary | `("#6366f1", null, "gradient")`        | `"#6366f1"` fallback       | Yes        |
| getMedicationBackground small dots     | `("#6366f1", "#ec4899", "dots", true)` | Gradient (not radial)      | Yes        |
| pushSubscriptionSchema valid FCM       | Valid FCM endpoint                     | `success: true`            | No         |
| pushSubscriptionSchema evil URL        | `"https://evil.com"`                   | `success: false`           | Yes        |
| pushSubscriptionSchema empty keys      | Missing p256dh                         | `success: false`           | Yes        |

### Edge Cases Checklist

- [x] Null secondary colour falls back to primary
- [x] Small=true uses gradient instead of geometric
- [x] Non-push-service URLs rejected
- [x] Empty/missing keys rejected
- [ ] MedicationWithStats type compiles after fix
- [ ] Reminders N+1 fix handles null lastTakenAt

---

## Validation Commands

### Static Analysis

```bash
npx svelte-check --tsconfig ./tsconfig.json
```

EXPECT: types.ts error gone, no new errors

### Unit Tests

```bash
npm test
```

EXPECT: All tests pass (existing + new)

### E2E Tests

```bash
npm run test:e2e
```

EXPECT: Smoke tests pass (requires dev server + DB)

### Manual Validation

- [ ] Navigate to `/nonexistent` — branded 404 page
- [ ] Remove DATABASE_URL from env — clear startup error
- [ ] `npm test` runs and exits cleanly
- [ ] Reminders cron produces same results (verified via audit log)

---

## Acceptance Criteria

- [ ] types.ts syntax error fixed
- [ ] N+1 query eliminated (1 query instead of N+1)
- [ ] Environment validation catches missing DATABASE_URL
- [ ] Error boundaries render branded 404/500 pages
- [ ] medication-style.ts has unit tests
- [ ] pushSubscriptionSchema has unit tests
- [ ] npm test/test:watch/test:e2e scripts work
- [ ] Playwright smoke tests pass
- [ ] No new type errors introduced

## Completion Checklist

- [ ] Test files follow existing `describe/it/expect` pattern
- [ ] Error pages use project's Tailwind tokens
- [ ] No hardcoded values in env validation
- [ ] N+1 fix maintains identical behavior
- [ ] .env.example clearly documents required vs optional

## Risks

| Risk                                              | Likelihood | Impact | Mitigation                                                 |
| ------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------- |
| Correlated subquery performance on large datasets | Low        | Low    | Index on dose_logs(medication_id, taken_at) already exists |
| E2E tests flaky due to dev server startup timing  | Medium     | Low    | `reuseExistingServer: true` + Playwright auto-waits        |
| Env validation too strict breaks deployments      | Low        | Medium | Only DATABASE_URL is required; everything else optional    |

## Notes

- The codebase already has 7 test suites with ~860 lines of tests — this plan fills the gaps rather than starting from scratch
- The N+1 in reminders.ts runs inside a Vercel cron (daily at 9am) — the fix improves it from O(N) queries to O(1) but the practical impact is small since N is currently low
- E2E tests require a running dev server with DATABASE_URL — they test against the real app, not mocks
- The types.ts `MedicationWithStats` missing brace is causing cascading type errors in other files
