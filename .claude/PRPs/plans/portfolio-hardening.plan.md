# Plan: Portfolio Hardening — Correctness, Reliability, Testing & Polish

## Summary

Close the remaining gaps between MedTracker's portfolio claims and its
implementation. Four phases: (1) correctness fixes for reminder
dedupe and inventory-on-status, (2) reliability/data-integrity work
on transactions and lifecycle dates, (3) testing depth (E2E +
reminder unit tests + staged coverage), and (4) portfolio polish
(threat model, privacy controls, refactor of `MedicationForm.svelte`,
ENCRYPTION_KEY hardening, refill events). Every item below is grounded
in code that already exists at a known file/line.

## User Story

As the maintainer of MedTracker (a portfolio project that must stand up
to recruiter scrutiny), I want every README claim to match the
implementation, the reliability gaps to be closed or honestly
documented, and tests to cover the most commercially important flows,
so that the repo demonstrates production-grade engineering discipline,
not just feature delivery.

## Problem → Solution

- **Problem**: README/ADR 0005 claim idempotent reminder dispatch via
  `reminder_events`, but the cron handler only dedupes in-memory
  within a single run. The table is defined but never written.
- **Problem**: `deleteDose` and `updateDose` adjust inventory without
  checking dose `status`, so a deleted skipped dose silently inflates
  stock by 1.
- **Problem**: Dose mutations + inventory updates run via
  `Promise.all`, not transactions — Neon HTTP can't transact, so
  partial failures leak.
- **Problem**: E2E coverage is three smoke tests; reminder logic has
  zero unit tests; coverage floors (`13/14/9/17`) are
  regression-only.
- **Problem**: `MedicationForm.svelte` is 634 LoC; no privacy controls
  page; no threat model; ENCRYPTION_KEY missing throws a 500 only when
  a user tries to enable 2FA.

→ **Solution**: Implement each of the items below in priority order
across four PRs (one per phase).

## Metadata

- **Complexity**: XL — multi-phase remediation; recommend splitting
  into four PRs.
- **Source PRD**: N/A (free-form review input from external code
  audit, captured 2026-05-01).
- **PRD Phase**: N/A
- **Estimated Files**: ~30 files touched across all phases.
- **Source review**: External audit "Executive Verdict" (2026-05-01)
- **Companion plan files**:
  - `.claude/PRPs/plans/improvements-broad.plan.md` (prior reviewer
    output; some items overlap and have shipped)
  - `.claude/PRPs/plans/improvements-execution.plan.md` (Phase 1 of
    that prior plan listed reminder dedupe; this plan closes the
    actual delivery gap)
  - `.claude/PRPs/plans/master-implementation.plan.md` (historical)

---

## UX Design

### Before
```
┌─ Reminders ────────────────────────────────────────────┐
│  Cron fires → in-memory Set dedupes within run        │
│  → email/push → no persistence                        │
│  Cron retried → user gets duplicate notifications     │
└────────────────────────────────────────────────────────┘

┌─ Skip dose → delete it ────────────────────────────────┐
│  Skip   → status="skipped", inventory unchanged       │
│  Delete → inventory ++ (✗ wrong: restores by qty=1   │
│                          even though nothing was      │
│                          decremented)                 │
└────────────────────────────────────────────────────────┘

┌─ Privacy ──────────────────────────────────────────────┐
│  No "download my data"                                │
│  No "delete account"                                  │
│  Reauth tokens exist but no UI surface                │
└────────────────────────────────────────────────────────┘
```

### After
```
┌─ Reminders ────────────────────────────────────────────┐
│  Cron fires → INSERT INTO reminder_events ON CONFLICT │
│             DO NOTHING (dedupe_key UNIQUE)            │
│  Insert succeeds → email/push                         │
│  Insert conflicts → skip silently                     │
│  Idempotent across cron runs and regions              │
└────────────────────────────────────────────────────────┘

┌─ Skip dose → delete it ────────────────────────────────┐
│  Skip   → status="skipped", inventory unchanged       │
│  Delete (skipped) → inventory unchanged               │
│  Delete (taken) → inventory ++                        │
│  Edit (skipped → quantity 2) → inventory unchanged    │
│  Edit (taken → quantity 2) → inventory diff applied   │
└────────────────────────────────────────────────────────┘

┌─ /(app)/settings/privacy ──────────────────────────────┐
│  Download my data (JSON export, reauth gated)         │
│  Delete all dose history (reauth gated)               │
│  Delete archived medications (reauth gated)           │
│  Delete account (reauth gated, 7-day grace)           │
│  Plain-language data inventory                        │
└────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Reminder cron retry | Duplicate emails | Idempotent (DB-level) | Driven by ADR 0005 |
| Delete skipped dose | Inventory ++ (wrong) | Inventory unchanged | Status-aware |
| Edit skipped dose qty | Inventory diff applied | Inventory unchanged | Status-aware |
| 2FA setup w/o ENCRYPTION_KEY | 500 error | UI disabled + clear admin notice | Pre-flight check |
| Settings menu | Account, Security | Account, Security, **Privacy** | New page |
| Add medication form | One 634-LoC file | Split into ~9 sub-components | Internal refactor |

---

## Mandatory Reading

Files that MUST be read before implementing each phase. Line ranges
are precise.

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/lib/server/reminders.ts` | 1-150 | Current cron logic, `isScheduleOverdue`, where dedupe must be wired |
| P0 | `src/lib/server/db/schema.ts` | 217-232 | `reminderEvents` table definition + unique `dedupeKey` |
| P0 | `src/lib/server/doses.ts` | 1-220 | `logDose`/`logSkippedDose`/`updateDose`/`deleteDose` (the status branches go here) |
| P0 | `src/lib/server/db/schema.ts` | 89-114 | `doseLogs` schema + `DoseLogStatus = "taken" \| "skipped" \| "missed"` |
| P0 | `src/lib/server/db/schema.ts` | 54-87 | `medications` schema (where `startedAt`/`endedAt` will be added) |
| P0 | `src/lib/server/db/schema.ts` | 120-141 | `medicationSchedules` (where `effectiveFrom`/`effectiveTo` will be added) |
| P1 | `src/lib/server/db/index.ts` | 1-10 | Neon HTTP client construction (transaction scope decision) |
| P1 | `src/lib/server/inventory.ts` | 1-100 | Refill forecasting (rules will need to handle inventory events) |
| P1 | `src/routes/api/cron/reminders/+server.ts` | 1-33 | Cron entry point — dedupe wiring lands here too |
| P1 | `tests/unit/export-csv.test.ts` | 1-59 | Vitest pattern: `vi.mock("$lib/server/db", () => ({ db: {} }))` |
| P1 | `tests/e2e/smoke.test.ts` | full | Playwright pattern + how the dev server is started |
| P1 | `playwright.config.ts` | full | webServer + baseURL conventions |
| P1 | `vite.config.ts` | 6-35 | Coverage thresholds block (the "regression floor" comment) |
| P1 | `src/lib/components/MedicationForm.svelte` | full | 634 LoC; identify boundaries for sub-components |
| P1 | `src/lib/server/auth/crypto.ts` | 1-30 | Where ENCRYPTION_KEY throws today |
| P2 | `src/lib/server/auth/reauth.ts` | 1-94 | `confirmReauth` / `requireRecentReauth` — used by privacy controls |
| P2 | `src/routes/(app)/settings/security/+page.server.ts` | full | Reauth UX pattern to mirror |
| P2 | `src/lib/server/audit.ts` | 1-29 | Audit pattern; `computeChanges`+`logAudit` |
| P2 | `docs/adr/0005-reminder-deduplication.md` | full | The contract Phase 1 must satisfy |
| P2 | `README.md` | 98-99, 135, 376-407 | Claims that must align with implementation |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Drizzle `onConflictDoNothing` | https://orm.drizzle.team/docs/insert#on-conflict-do-nothing | Drizzle supports it on `.insert(...)` chain — no raw SQL needed |
| Neon serverless transactions | https://github.com/neondatabase/serverless | HTTP driver does **not** support `BEGIN/COMMIT`; the `@neondatabase/serverless` package also exposes a websocket driver (`Pool`) that does |
| Playwright auth state | https://playwright.dev/docs/auth | Use `storageState` to avoid logging in for every test |
| axe-core / @axe-core/playwright | https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright | Drop-in for accessibility E2E |

No external research needed for the inventory/status fixes, lifecycle
dates, or refactor — those use established internal patterns.

---

## Patterns to Mirror

### NAMING_CONVENTION
```typescript
// SOURCE: src/lib/server/doses.ts:61
export async function logDose(
  userId: string,
  medicationId: string,
  // ...
) { /* ... */ }

// SOURCE: src/lib/server/db/schema.ts:114
export type DoseLogStatus = "taken" | "skipped" | "missed";

// SOURCE: src/lib/server/auth/reauth.ts:8-14
export type ReauthPurpose =
  | "change_password"
  | "enable_2fa"
  | /* ... */;
```
- Server functions: `camelCase` verbs (`logDose`, `confirmReauth`).
- Types: `PascalCase`, exported alongside the table they describe.
- Tables: `camelCase` Drizzle export name, `snake_case` SQL name.

### OWNERSHIP_GUARD
```typescript
// SOURCE: src/lib/server/doses.ts:16-24
async function assertMedicationBelongsToUser(
  userId: string,
  medicationId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
    .limit(1);
  if (!row) throw new MedicationNotFoundError(medicationId);
}
```
- Every service function that mutates dose data calls this first.

### USER_SCOPED_DELETE (defence-in-depth)
```typescript
// SOURCE: src/lib/server/doses.ts:148 — currently DOES NOT scope by user
await db.delete(doseLogs).where(eq(doseLogs.id, doseId));

// REPLACE WITH (the pattern you already use in updateDose):
// SOURCE: src/lib/server/doses.ts:184-185
await db
  .delete(doseLogs)
  .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)));
```

### AUDIT_LOG
```typescript
// SOURCE: src/lib/server/audit.ts:17-28
await logAudit(userId, "dose_log", id, "create");
// or with diff:
const changes = computeChanges(existing, updated);
if (changes) await logAudit(userId, "dose_log", doseId, "update", changes);
```

### FORM_ACTION
```typescript
// SOURCE: src/routes/(app)/log/+page.server.ts:112-125
editDose: async ({ request, locals }) => {
  const formData = Object.fromEntries(await request.formData());
  const parsed = doseEditSchema.safeParse(formData);
  if (!parsed.success) return fail(400, { editErrors: parsed.error.flatten().fieldErrors });
  const { doseId, /* ... */ } = parsed.data;
  await updateDose(locals.user!.id, doseId, { /* ... */ });
  return { success: true };
}
```

### TEST_STRUCTURE (db-mocked unit test)
```typescript
// SOURCE: tests/unit/export-csv.test.ts:1-7
import { describe, it, expect, vi } from "vitest";
vi.mock("$lib/server/db", () => ({ db: {} }));
const { escapeCsvCell } = await import("../../src/lib/server/export-csv");

describe("escapeCsvCell", () => {
  it("passes through plain values", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
  });
});
```
- Mock the db **before** importing the module under test.
- Co-locate tests at `tests/unit/<module>.test.ts`.

### REMINDER_DOMAIN_PURE_FUNCTION (already exists; mirror for new helpers)
```typescript
// SOURCE: src/lib/server/reminders.ts:106-136
function isScheduleOverdue(row: OverdueRow, now: Date): boolean {
  if (row.scheduleKind === "interval") { /* ... */ }
  if (row.scheduleKind === "fixed_time") { /* ... */ }
  return false;
}
```
- New dedupe-key builders should follow the same shape: pure, no I/O,
  fully testable.

### COVERAGE_THRESHOLDS
```typescript
// SOURCE: vite.config.ts:25-32
thresholds: {
  statements: 13,
  branches: 14,
  functions: 9,
  lines: 17,
},
```
- The comment in this file says these are regression floors.
- Phase 3 will raise them stage by stage.

---

## Files to Change

### Phase 1 — Correctness fixes
| File | Action | Justification |
|---|---|---|
| `src/lib/server/reminders.ts` | UPDATE | Extract pure dedupe-key builders; wire `reminder_events` insert-or-skip; persist before notify |
| `src/lib/server/reminders/domain.ts` | CREATE | New module for pure helpers (`isScheduleOverdue`, dedupe builders) |
| `src/lib/server/doses.ts` | UPDATE | `deleteDose`/`updateDose` gated on `existing.status === "taken"`; user-scoped delete |
| `tests/unit/doses-inventory.test.ts` | CREATE | Status-aware inventory tests (mock db) |
| `tests/unit/reminders-dedupe.test.ts` | CREATE | Dedupe-key builders + `isScheduleOverdue` table |
| `README.md` | UPDATE | Re-verify reminder + transaction sections still match code |

### Phase 2 — Reliability
| File | Action | Justification |
|---|---|---|
| `src/lib/server/db/index.ts` | UPDATE (decision) | Keep `neon-http` OR add a `neon` (websocket) `Pool` export for transactional paths |
| `src/lib/server/doses.ts` | UPDATE | Wrap dose+inventory writes in `db.transaction(...)` (or document the limitation per dose path) |
| `src/lib/server/medications.ts` | UPDATE | Schedule replacement: transactional or versioned |
| `drizzle/<NEW>_lifecycle_dates.sql` | CREATE | `medications.started_at`, `medications.ended_at`, `medication_schedules.effective_from`, `medication_schedules.effective_to` |
| `src/lib/server/db/schema.ts` | UPDATE | Add lifecycle columns; tests + analytics will read them |
| `src/lib/server/analytics.ts` | UPDATE | Use lifecycle dates so days outside `[startedAt, endedAt]` aren't counted as missed |
| `src/lib/components/MedicationForm.svelte` | UPDATE | Surface `startedAt`/`endedAt` (optional) — minimal UI |
| `tests/unit/analytics-lifecycle.test.ts` | CREATE | Verify lifecycle bounds exclude pre-start days |

### Phase 3 — Testing
| File | Action | Justification |
|---|---|---|
| `tests/e2e/auth.test.ts` | CREATE | Register → confirm email skipped via dev hook → log in |
| `tests/e2e/medication-flow.test.ts` | CREATE | Add medication → fixed-time schedule → log dose → see in timeline → edit dose → skip dose |
| `tests/e2e/history-export.test.ts` | CREATE | Filter dose history → CSV export download |
| `tests/e2e/analytics.test.ts` | CREATE | Analytics renders with seeded data |
| `tests/e2e/quick-log.test.ts` | CREATE | Keyboard quick-log path + modal focus |
| `tests/e2e/a11y.test.ts` | CREATE | axe-core scan of dashboard, log, analytics, settings |
| `tests/e2e/fixtures.ts` | CREATE | Login helper, seeded user, `storageState` export |
| `tests/e2e/global-setup.ts` | CREATE | Seeds the E2E user once per run |
| `src/routes/api/test/seed/+server.ts` | CREATE | Dev-only seed endpoint, gated on `dev \|\| env.E2E_SEEDS === "1"` |
| `playwright.config.ts` | UPDATE | Add `globalSetup` for seeded user; project for `chromium` only |
| `package.json` | UPDATE | Add `@axe-core/playwright`, `test:e2e` script |
| `vite.config.ts` | UPDATE | Coverage threshold step-up: 30/25/25/30 → 55/45/50/55 over Phase 3 |

### Phase 4 — Polish
| File | Action | Justification |
|---|---|---|
| `docs/threat-model.md` | CREATE | Assets, threats, controls, known limitations |
| `docs/architecture.md` | CREATE | Mermaid diagram + request flow narrative |
| `src/routes/(app)/settings/privacy/+page.server.ts` | CREATE | Data export + dose-history wipe + archived-meds wipe + account delete (reauth-gated) |
| `src/routes/(app)/settings/privacy/+page.svelte` | CREATE | UI for the above |
| `src/lib/server/privacy.ts` | CREATE | `exportUserData`, `wipeDoseHistory`, `purgeArchivedMedications`, `scheduleAccountDeletion` |
| `src/lib/components/medication-form/MedicationForm.svelte` | CREATE (move) | Lean parent |
| `src/lib/components/medication-form/MedicationIdentityFields.svelte` | CREATE | Name + interactions banner |
| `src/lib/components/medication-form/DosageFields.svelte` | CREATE | Dosage amount + unit + form + category |
| `src/lib/components/medication-form/MedicationColourPicker.svelte` | CREATE | Primary/secondary colour |
| `src/lib/components/medication-form/MedicationPatternPreview.svelte` | CREATE | Live pill preview |
| `src/lib/components/medication-form/ScheduleEditor.svelte` | CREATE | Mode selector + slot rows |
| `src/lib/components/medication-form/ScheduleRowEditor.svelte` | CREATE | Single time/day-of-week row |
| `src/lib/components/medication-form/InventoryFields.svelte` | CREATE | Inventory + alert threshold |
| `src/lib/components/medication-form/InteractionWarningPanel.svelte` | CREATE | OpenFDA banner |
| `src/lib/components/MedicationForm.svelte` | DELETE | Old monolith |
| `src/routes/(app)/medications/new/+page.svelte` | UPDATE | Import path change only |
| `src/routes/(app)/medications/[id]/+page.svelte` | UPDATE | Import path change only |
| `src/lib/server/auth/totp.ts` | UPDATE | Add `isEncryptionKeyConfigured()`; load it in 2FA route loader; UI hides setup if `false` |
| `src/routes/auth/2fa/+page.server.ts` | UPDATE | Pre-flight ENCRYPTION_KEY check; error before TOTP secret generation |
| `drizzle/<NEW>_inventory_events.sql` | CREATE | New `medication_inventory_events` table |
| `src/lib/server/db/schema.ts` | UPDATE | `medicationInventoryEvents` table |
| `src/lib/server/inventory.ts` | UPDATE | Write events alongside the bare counter; new `getInventoryHistory(medicationId)` |
| `src/lib/server/doses.ts` | UPDATE | Emit `dose_taken` / `dose_taken_reverted` events in tandem with inventory adjustments |
| `src/routes/(app)/medications/[id]/+page.svelte` | UPDATE | Show recent inventory events (refills + adjustments) |
| `package.json` | UPDATE | Confirm/remove `playwright` if `@playwright/test` is sufficient |
| `README.md` | UPDATE | Cross-link threat model + architecture; mark privacy controls live |

## NOT Building

- **Universal account-recovery flow** (the existing reset-password
  flow is sufficient).
- **Background-job queue / worker** for reminder dispatch — the cron
  endpoint is fine for Vercel.
- **Real-time sync** between devices.
- **Drug interaction database** beyond the existing OpenFDA opt-in
  feature.
- **Multi-tenant / clinic / household features** — out of scope for a
  personal portfolio app.
- **Switching off Neon entirely**. If transactions matter we add the
  websocket-driver `Pool` alongside HTTP, we don't migrate hosting.
- **PWA-installability and Web Push** beyond what already ships
  (covered in `completed/pwa-installability-push-notifications.plan.md`).
- **Bumping coverage to 80%** in this iteration. Phase 3's stop is
  55/45/50/55.
- **Visual regression testing**, performance budgets, Lighthouse CI.

---

## Step-by-Step Tasks

> **PR strategy**: One PR per phase (4 PRs).
> **Branches**: `feat/phase-1-correctness`, `feat/phase-2-reliability`,
> `feat/phase-3-testing`, `feat/phase-4-polish`.

---

### Phase 1 — Correctness fixes

#### Task 1.1: Wire `reminder_events` for dedupe (P0)

- **ACTION**: Write a `tryRecordReminderEvent` helper that performs an
  insert-or-skip on `reminder_events`. Call it inside
  `checkOverdueMedications` and `checkLowInventoryMedications`
  **before** sending email/push. If the insert reports zero rows,
  skip notify silently.
- **IMPLEMENT**:
  ```typescript
  // src/lib/server/reminders.ts (new top-level helpers, exported for tests)
  import { createId } from "@paralleldrive/cuid2";
  import { reminderEvents } from "$lib/server/db/schema";

  export type ReminderType = "overdue" | "low_inventory";

  export function buildOverdueDedupeKey(
    userId: string,
    medicationId: string,
    scheduleKind: "fixed_time" | "interval",
    scheduleId: string,
    nextDueAt: Date,
  ): string {
    return `${userId}:${medicationId}:overdue:${scheduleKind}:${scheduleId}:${nextDueAt.toISOString()}`;
  }

  export function buildLowInventoryDedupeKey(
    userId: string,
    medicationId: string,
    inventoryCount: number,
  ): string {
    return `${userId}:${medicationId}:low_inventory:${inventoryCount}`;
  }

  async function tryRecordReminderEvent(input: {
    userId: string;
    medicationId: string;
    reminderType: ReminderType;
    dedupeKey: string;
  }): Promise<boolean> {
    const inserted = await db
      .insert(reminderEvents)
      .values({
        id: createId(),
        userId: input.userId,
        medicationId: input.medicationId,
        reminderType: input.reminderType,
        dedupeKey: input.dedupeKey,
      })
      .onConflictDoNothing({ target: reminderEvents.dedupeKey })
      .returning({ id: reminderEvents.id });
    return inserted.length === 1;
  }
  ```
  Inside `checkOverdueMedications`, replace the in-memory `Set` with:
  ```typescript
  const nextDueAt = computeNextDueAt(row, now); // pure helper, see Task 1.2
  const dedupeKey = buildOverdueDedupeKey(
    row.userId, row.medicationId, row.scheduleKind, row.scheduleId, nextDueAt,
  );
  const recorded = await tryRecordReminderEvent({
    userId: row.userId,
    medicationId: row.medicationId,
    reminderType: "overdue",
    dedupeKey,
  });
  if (!recorded) continue;
  // …existing email/push code unchanged…
  ```
  Mirror the same pattern in `checkLowInventoryMedications` using
  `buildLowInventoryDedupeKey` (key only re-fires when the count
  crosses to a new value).
- **MIRROR**: `OWNERSHIP_GUARD` for "DB call before side effect"
  ordering; `REMINDER_DOMAIN_PURE_FUNCTION` for the new pure
  builders.
- **IMPORTS**:
  ```typescript
  import { createId } from "@paralleldrive/cuid2";
  import { reminderEvents } from "$lib/server/db/schema";
  ```
- **GOTCHA**:
  - The dedupe key for fixed-time slots needs `nextDueAt` to be the
    **slot time, not `now`** — otherwise every cron run produces a
    new key. Compute it from `localTimeOnDateToUtc` (already used
    inside `isScheduleOverdue`).
  - For interval schedules, key on `lastTakenAt.toISOString()` so the
    same overdue window only fires once.
  - `onConflictDoNothing` requires Drizzle ≥ 0.30 — check
    `package.json`.
- **VALIDATE**:
  - Unit test: insert the same dedupe key twice; second insert returns
    `false`.
  - Manual: `npm run dev`, mark a medication overdue by editing the
    last `taken_at`, hit `/api/cron/reminders` twice; expect one
    email and one `reminder_events` row (second cron call no-ops).

#### Task 1.2: Extract pure functions for reminder testability (P1)

- **ACTION**: Extract three pure functions from `reminders.ts` so they
  can be unit-tested without DB access:
  `computeNextDueAt(row, now)`, `shouldFireOverdueReminder(row, now)`,
  `shouldFireLowInventoryReminder(med, threshold)`. Keep
  `isScheduleOverdue` (already pure).
- **IMPLEMENT**: Move `isScheduleOverdue` + new helpers to a new
  module `src/lib/server/reminders/domain.ts`; the existing
  `reminders.ts` re-exports for back-compat or imports them.
- **MIRROR**: `REMINDER_DOMAIN_PURE_FUNCTION` (lines 106-136).
- **IMPORTS**: re-export from existing module.
- **GOTCHA**: don't change the boundary between
  `checkOverdueMedications` and `checkLowInventoryMedications` — the
  cron handler imports them by name.
- **VALIDATE**: existing reminders behaviour unchanged; new unit
  test file covers ≥ 12 cases (see Task 1.5).

#### Task 1.3: Status-aware inventory mutations (P0)

- **ACTION**: In `src/lib/server/doses.ts`, gate inventory restoration
  in `deleteDose` and inventory diff in `updateDose` on
  `existing.status === "taken"`. Skipped/missed dose mutations must
  not change `medications.inventoryCount`.
- **IMPLEMENT**:
  ```typescript
  // deleteDose, replacing lines 135-149 of the parallel block:
  const shouldRestoreInventory = dose.status === "taken";
  const ops: Promise<unknown>[] = [
    db
      .delete(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId))),
  ];
  if (shouldRestoreInventory) {
    ops.push(
      db
        .update(medications)
        .set({ inventoryCount: sql`${medications.inventoryCount} + ${dose.quantity}` })
        .where(
          and(
            eq(medications.id, dose.medicationId),
            eq(medications.userId, userId),
            isNotNull(medications.inventoryCount),
          ),
        ),
    );
  }
  await Promise.all(ops);
  ```
  ```typescript
  // updateDose, gating the inventory diff push (line ~191):
  const inventoryAffectingChange =
    existing.status === "taken" &&
    updates.quantity !== undefined &&
    updates.quantity !== existing.quantity;
  if (inventoryAffectingChange) { /* …existing diff push… */ }
  ```
- **MIRROR**: `USER_SCOPED_DELETE` for the new
  `and(eq(...), eq(userId))` filter on the delete itself.
- **IMPORTS**: none new.
- **GOTCHA**:
  - Status-changing edits (taken → skipped or skipped → taken) are
    **out of scope** for this task — the form action does not let a
    user change status today; if it ever did, the diff logic would
    need to apply `+ existing.quantity` (when changing taken→skipped)
    or `- updates.quantity` (when changing skipped→taken). Document
    in the task body, not the code.
  - `Promise.all` is intentional for parallelism but is **not** a
    transaction — Phase 2 fixes that.
- **VALIDATE**: see Task 1.6 unit tests; plus manual smoke:
  1. Log a dose, inventory −1.
  2. Skip a dose, inventory unchanged.
  3. Delete the skipped dose, inventory unchanged.
  4. Delete the logged dose, inventory +1 back.

#### Task 1.4: User-scoped delete, defence-in-depth (P1)

- **ACTION**: Update `deleteDose` to scope its `delete()` by
  `userId` even though the row was already fetched with the same
  scope.
- **IMPLEMENT**: change `eq(doseLogs.id, doseId)` to
  `and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId))`. Also
  audit `medications.ts`, `schedules.ts`, `notes.ts` (if present)
  for any unconditional delete and apply the same pattern.
- **MIRROR**: `USER_SCOPED_DELETE` (already in `updateDose`).
- **IMPORTS**: none new.
- **GOTCHA**: this is a no-op on the happy path because the
  pre-fetch is user-scoped — but it's an enforcement layer the
  reviewer specifically called out.
- **VALIDATE**: existing tests pass; consider an integration test
  that asserts a delete with mismatched userId returns 0 rows. Add
  to `tests/unit/doses-inventory.test.ts`.

#### Task 1.5: Reminder logic unit tests (P1)

- **ACTION**: Create `tests/unit/reminders-dedupe.test.ts`. Cover:
  - `buildOverdueDedupeKey` is deterministic.
  - `buildLowInventoryDedupeKey` changes only when count changes.
  - `isScheduleOverdue` table:
    - Fixed-time slot in the future → not overdue.
    - Fixed-time slot in past, no dose → overdue.
    - Fixed-time slot in past, matching dose within tolerance → not
      overdue.
    - Day-of-week excludes today → not overdue.
    - Interval, never taken → not overdue (current behaviour).
    - Interval, last dose > intervalHours ago → overdue.
- **IMPLEMENT**:
  ```typescript
  import { describe, it, expect, vi } from "vitest";
  vi.mock("$lib/server/db", () => ({ db: {} }));
  const {
    isScheduleOverdue,
    buildOverdueDedupeKey,
    buildLowInventoryDedupeKey,
  } = await import("../../src/lib/server/reminders/domain");

  describe("buildOverdueDedupeKey", () => {
    it("is stable for the same inputs", () => {
      const slot = new Date("2026-05-01T08:00:00Z");
      expect(
        buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot),
      ).toBe(buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot));
    });
  });
  // …more `describe` blocks…
  ```
- **MIRROR**: `TEST_STRUCTURE` (`vi.mock` of `$lib/server/db`).
- **IMPORTS**: as shown.
- **GOTCHA**: the existing `isScheduleOverdue` is `function` (not
  `export function`); change it to `export function` as part of
  Task 1.2 so it's importable.
- **VALIDATE**: `npx vitest run tests/unit/reminders-dedupe.test.ts`
  ≥ 12 passing tests.

#### Task 1.6: Status-aware inventory unit tests (P0)

- **ACTION**: Create `tests/unit/doses-inventory.test.ts`. Cover:
  - Delete taken → expect `db.update(medications)` called once.
  - Delete skipped → expect `db.update(medications)` **not** called.
  - Edit taken qty → expect inventory diff push.
  - Edit skipped qty → expect no inventory push.
  - Skipped dose excluded from "last taken" calculation (regression
    on `getLastDosePerMedication`).
- **IMPLEMENT**: db mock is more elaborate than `escapeCsvCell`. Use:
  ```typescript
  import { describe, it, expect, vi } from "vitest";

  const updateMock = vi.fn();
  const deleteMock = vi.fn();
  // …minimal db mock that records calls and returns shaped data…
  vi.mock("$lib/server/db", () => ({
    db: { /* select/insert/update/delete chain mocks */ },
  }));

  const { deleteDose, updateDose } = await import("../../src/lib/server/doses");
  ```
  Use `vi.spyOn(db, "update")` to assert calls.
- **MIRROR**: `TEST_STRUCTURE`. The export-csv test only mocks
  `db: {}` because it doesn't call db; doses tests do — write a
  thin chainable stub that returns arrays from `.where(...).limit(...)`
  and from `.returning()`.
- **IMPORTS**: as shown.
- **GOTCHA**: the dose service uses `Promise.all([...])`; assert
  that `update(medications)` is in the array only when expected.
- **VALIDATE**: `npx vitest run tests/unit/doses-inventory.test.ts`
  ≥ 5 passing tests; coverage on `src/lib/server/doses.ts`
  meaningfully up.

#### Task 1.7: README claim alignment sweep (P1)

- **ACTION**: After Phase 1 tasks ship, re-read README sections at
  lines 98-99, 135, 376-407 and verify each claim against the new
  code. Update wording if anything still drifts.
- **IMPLEMENT**: Spot edits only.
- **MIRROR**: existing README tone (the sections are already
  carefully hedged; keep that voice).
- **GOTCHA**: do **not** delete the "Neon HTTP transactions" caveat
  unless Phase 2 actually delivers transactions; otherwise the README
  will lead the code again.
- **VALIDATE**: `git diff README.md` shows only verifiable claims.

---

### Phase 2 — Reliability & data integrity

#### Task 2.1: Decide transactions vs document (P0)

- **ACTION**: Run a one-day spike: introduce
  `@neondatabase/serverless`'s `Pool` (websocket driver) alongside
  HTTP. Wrap dose+inventory writes in `db.transaction(...)`.
  Benchmark cold-start cost on Vercel. If unacceptable, document
  the constraint clearly and add reconciliation.
- **IMPLEMENT (option A: dual driver)**:
  ```typescript
  // src/lib/server/db/index.ts
  import { neon, Pool } from "@neondatabase/serverless";
  import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
  import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
  import * as schema from "./schema";
  import { env } from "$env/dynamic/private";

  const sql = neon(env.DATABASE_URL!);
  export const db = drizzleHttp(sql, { schema });

  const pool = new Pool({ connectionString: env.DATABASE_URL! });
  export const dbTx = drizzleWs(pool, { schema });
  ```
  Then in `doses.ts`:
  ```typescript
  await dbTx.transaction(async (tx) => {
    await tx.insert(doseLogs).values({ /* … */ });
    await tx
      .update(medications)
      .set({ inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} - ${quantity})` })
      .where(/* … */);
  });
  ```
- **MIRROR**: existing `db` import shape; `dbTx` is the new
  transactional sibling.
- **IMPORTS**: `Pool` from `@neondatabase/serverless`,
  `drizzle as drizzleWs` from `drizzle-orm/neon-serverless`.
- **GOTCHA**:
  - Vercel's serverless functions hold an open WS — cold-start cost
    is real. Benchmark before committing.
  - `audit_log` insert can stay outside the transaction if you want
    audit to survive a rollback.
- **VALIDATE**:
  - Unit test: simulate `update(medications)` rejecting; assert dose
    row is **not** persisted.
  - Production smoke: log + immediately delete a dose 100×; expect
    no inventory drift.

#### Task 2.2: Schedule replacement safety (P1)

- **ACTION**: `replaceSchedules(medicationId, schedules)` currently
  delete-then-insert. Wrap in `dbTx.transaction` from Task 2.1, or
  switch to a versioned model with a `schedules.is_active` column.
- **IMPLEMENT**: prefer transaction (smaller diff). If 2.1 went the
  "document and reconcile" route, pivot to versioned model.
- **MIRROR**: same `dbTx.transaction(async (tx) => {...})` pattern.
- **IMPORTS**: `dbTx` from `$lib/server/db`.
- **GOTCHA**: `medication_schedules.sortOrder` must be reseeded —
  delete-then-insert preserved nothing; transaction makes that safe
  but doesn't change the sortOrder behaviour itself.
- **VALIDATE**: edit a medication's schedule from 3 slots to 1; cancel
  midway via simulated DB error; expect the original 3 slots to remain.

#### Task 2.3: Lifecycle dates on medications + schedules (P1)

- **ACTION**: Add `medications.startedAt`, `medications.endedAt`,
  `medication_schedules.effectiveFrom`,
  `medication_schedules.effectiveTo`. Backfill `startedAt` to
  `createdAt` for existing rows; `effectiveFrom` to schedule
  `createdAt`. Index `(userId, startedAt)` and
  `(medicationId, effectiveFrom)`.
- **IMPLEMENT**:
  ```sql
  -- drizzle/<NEW>_lifecycle_dates.sql
  ALTER TABLE medications ADD COLUMN started_at timestamptz;
  ALTER TABLE medications ADD COLUMN ended_at timestamptz;
  UPDATE medications SET started_at = created_at WHERE started_at IS NULL;
  ALTER TABLE medications ALTER COLUMN started_at SET NOT NULL;
  CREATE INDEX medications_user_started_idx ON medications (user_id, started_at);

  ALTER TABLE medication_schedules ADD COLUMN effective_from timestamptz;
  ALTER TABLE medication_schedules ADD COLUMN effective_to timestamptz;
  UPDATE medication_schedules SET effective_from = created_at WHERE effective_from IS NULL;
  ALTER TABLE medication_schedules ALTER COLUMN effective_from SET NOT NULL;
  CREATE INDEX medication_schedules_med_effective_idx ON medication_schedules (medication_id, effective_from);
  ```
  Update `schema.ts` accordingly.
- **MIRROR**: existing column order in `medications`/`medicationSchedules`
  tables (timestamp-with-tz, default now() where appropriate).
- **IMPORTS**: none new.
- **GOTCHA**:
  - `endedAt`/`effectiveTo` stay nullable — null means "still active".
  - Analytics will need to skip days outside the lifecycle window —
    Task 2.4.
  - Drizzle journal drift (see memory `project_drizzle_journal_drift`):
    generate the migration locally and **commit the journal** so prod
    stays in sync.
- **VALIDATE**: `npm run db:generate` + `npm run db:migrate` on a
  scratch DB; verify `psql -c '\d medications'` shows the new columns.

#### Task 2.4: Analytics respects lifecycle (P1)

- **ACTION**: In `src/lib/server/analytics.ts`, filter the "expected
  doses" denominator so days before `startedAt` and after `endedAt`
  aren't counted as missed. Same for schedule effective window.
- **IMPLEMENT**: changes are localised to the function that builds
  the daily expected-vs-actual table. Read the existing
  implementation; the filter is a simple
  `if (day < startedAt || (endedAt && day > endedAt)) skip;`.
- **MIRROR**: existing `for (const day of dateRange)` loop in
  `analytics.ts`.
- **IMPORTS**: schema columns already imported.
- **GOTCHA**: the schedule effectiveFrom/effectiveTo have the same
  semantics — also filter at the schedule level when computing
  per-schedule expectations.
- **VALIDATE**: `tests/unit/analytics-lifecycle.test.ts` covers:
  - Adding a med yesterday → today's adherence not 0% (was a miss
    before for the days before yesterday).
  - Ended med doesn't drag adherence down after `endedAt`.

---

### Phase 3 — Testing depth

#### Task 3.1: Playwright fixtures + auth helper (P1)

- **ACTION**: Add `tests/e2e/fixtures.ts` exporting a `test` extended
  with a `seededUser` fixture and a logged-in `page`. Use
  `globalSetup` to create the user once per run.
- **IMPLEMENT**:
  ```typescript
  // tests/e2e/fixtures.ts
  import { test as base, expect } from "@playwright/test";
  type TestFixtures = { seededUser: { email: string; password: string } };
  export const test = base.extend<TestFixtures>({
    seededUser: async ({}, use) => {
      await use({ email: "e2e@medtracker.test", password: "Test1234!Test" });
    },
  });
  export { expect };
  ```
  ```typescript
  // tests/e2e/global-setup.ts
  import { request } from "@playwright/test";
  export default async () => {
    // hit /api/test/seed (create only in NODE_ENV=test) to ensure user exists
  };
  ```
  Add a dev-only `/api/test/seed/+server.ts` gated on
  `dev || env.E2E_SEEDS === "1"`.
- **MIRROR**: existing `webServer` config in `playwright.config.ts`.
- **IMPORTS**: as shown.
- **GOTCHA**:
  - Don't rely on the production register flow if it requires email
    verification — bypass via the seed endpoint.
  - Set `storageState` on the project so subsequent tests skip login.
- **VALIDATE**: `npx playwright test --headed` opens an authed page
  for the seeded user.

#### Task 3.2: Core medication-flow E2E (P1)

- **ACTION**: `tests/e2e/medication-flow.test.ts` covers:
  add medication → fixed-time schedule (08:00) → log dose → verify
  it's in today's timeline → edit dose qty → skip the next dose →
  confirm inventory unchanged after the skip.
- **IMPLEMENT**: use `getByRole`/`getByLabel` selectors (no CSS
  selectors). Each step must be wrapped in `await expect(...)`.
- **MIRROR**: smoke.test.ts pattern (already covers redirect logic).
- **IMPORTS**: from `./fixtures`.
- **GOTCHA**: the form action returns `{ success: true }`; assert by
  observing the DOM update, not the response.
- **VALIDATE**: `npx playwright test medication-flow` green.

#### Task 3.3: History / export / analytics / quick-log E2E (P1)

- **ACTION**: One file each for: history filter + CSV download,
  analytics renders charts, keyboard quick-log opens the modal,
  modal traps focus correctly.
- **IMPLEMENT**: for CSV download use `page.waitForEvent("download")`
  and assert the body contains `"Medication","Quantity","Taken at"`.
- **MIRROR**: smoke + medication-flow patterns.
- **IMPORTS**: from `./fixtures`.
- **GOTCHA**: analytics charts are rendered server-side as inline
  SVG (`Sparkline.svelte`) — assert presence of `<svg>` not canvas.
- **VALIDATE**: `npx playwright test` all green.

#### Task 3.4: Accessibility E2E with axe (P1)

- **ACTION**: Add `@axe-core/playwright`; scan dashboard, log,
  analytics, settings; fail on any `serious` or `critical`
  violation.
- **IMPLEMENT**:
  ```typescript
  import AxeBuilder from "@axe-core/playwright";
  const results = await new AxeBuilder({ page })
    .withTags(["wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(blocking).toEqual([]);
  ```
- **MIRROR**: existing pattern from `accessibility-wcag-2-2-aa.plan.md`
  (already in `completed/`).
- **IMPORTS**: `@axe-core/playwright`.
- **GOTCHA**: WCAG 2.2 AA tags are not all enabled in axe-core by
  default — explicitly include `wcag22aa`.
- **VALIDATE**: green run; allowlist any pre-existing minor
  violations explicitly in a comment.

#### Task 3.5: Stage coverage thresholds upward (P1)

- **ACTION**: Bump thresholds in three commits (one per stage):
  - Stage 1: `30/25/25/30`
  - Stage 2: `45/35/40/45`
  - Stage 3 (target for this PR): `55/45/50/55`
- **IMPLEMENT**: edit `vite.config.ts` `thresholds` block.
- **MIRROR**: `COVERAGE_THRESHOLDS` block.
- **IMPORTS**: none.
- **GOTCHA**: each bump must be paired with the unit tests that lift
  coverage — don't bump the threshold without raising the actual
  number, or CI breaks for everyone else.
- **VALIDATE**: `npm run test:coverage` green at each stage.

---

### Phase 4 — Portfolio polish

#### Task 4.1: Threat model document (P2)

- **ACTION**: Write `docs/threat-model.md` covering: assets
  (medication names, dose history, email, sessions, TOTP secrets),
  threats (account takeover, cross-user data access, repeated
  reminders, CSV injection, leaked secrets, stale sessions),
  controls (ownership checks, Zod validation, Argon2id, session
  revocation, TOTP encryption, rate limiting, CSP, Gitleaks),
  known limitations (Neon HTTP non-transactional unless 2.1 ships,
  limited E2E if 3.x not done).
- **IMPLEMENT**: 1–2 page markdown using STRIDE-lite categories.
- **MIRROR**: existing `docs/adr/` style — short, opinionated,
  stable.
- **IMPORTS**: link from README "Security" section.
- **GOTCHA**: don't claim controls that don't exist. If rate
  limiting is partial, say "rate limit on `/auth/login` only".
- **VALIDATE**: README link resolves; `npm run check` clean.

#### Task 4.2: Architecture diagram (P2)

- **ACTION**: `docs/architecture.md` with one Mermaid sequence
  diagram (browser → SvelteKit form action → service → Drizzle →
  Postgres) and one component diagram (auth, dose service, reminder
  cron, analytics, export).
- **IMPLEMENT**: GitHub renders Mermaid natively — no build step.
- **MIRROR**: existing ADR markdown formatting.
- **IMPORTS**: linked from README.
- **GOTCHA**: keep it diagram-first, not prose-first; the README
  already has the prose.
- **VALIDATE**: render in GitHub PR preview, eyeball.

#### Task 4.3: Privacy controls page (P1)

- **ACTION**: New route `/(app)/settings/privacy` with four
  reauth-gated actions: download my data, wipe dose history, purge
  archived medications, schedule account deletion. Plus a
  plain-language data inventory ("we store: …; we do not store:
  …").
- **IMPLEMENT**:
  ```typescript
  // src/lib/server/privacy.ts
  export async function exportUserData(userId: string) {
    // pull medications, schedules, doseLogs, audit, preferences
    // return as a JSON blob (re-uses existing CSV export logic for tables)
  }
  export async function wipeDoseHistory(userId: string) {
    await db.delete(doseLogs).where(eq(doseLogs.userId, userId));
    await logAudit(userId, "user", userId, "delete");
  }
  export async function purgeArchivedMedications(userId: string) { /* … */ }
  export async function scheduleAccountDeletion(userId: string) {
    // set users.deletionScheduledAt = now() + 7 days
    // cron deletes after grace
  }
  ```
  Form actions wrap each in `requireRecentReauth` from
  `src/lib/server/auth/reauth.ts`.
- **MIRROR**: `src/routes/(app)/settings/security/+page.server.ts`
  reauth pattern; `FORM_ACTION` pattern.
- **IMPORTS**: `requireRecentReauth`, `confirmReauth` from
  `$lib/server/auth/reauth`.
- **GOTCHA**:
  - Account deletion needs a grace window — design the cron sweep
    and the "cancel scheduled deletion" UI before promising it in
    the README.
  - The data export must be JSON (machine readable) per GDPR-style
    expectations, not just the CSV that already exists.
- **VALIDATE**: manual flow → log in → settings → privacy → confirm
  password → download data → JSON validates against a schema.

#### Task 4.4: ENCRYPTION_KEY pre-flight (P1)

- **ACTION**: Stop the 2FA setup page from generating a TOTP secret
  if `ENCRYPTION_KEY` is missing. Show a clear admin notice.
- **IMPLEMENT**:
  ```typescript
  // src/lib/server/auth/totp.ts
  export function isEncryptionKeyConfigured(): boolean {
    return Boolean(process.env.ENCRYPTION_KEY?.length);
  }
  ```
  In the loader for `/auth/2fa/+page.server.ts`:
  ```typescript
  return {
    encryptionKeyConfigured: isEncryptionKeyConfigured(),
    // …existing data…
  };
  ```
  In the page, hide the QR/setup form when `false` and render a
  "2FA temporarily disabled by configuration" notice.
- **MIRROR**: existing `+page.server.ts` loader pattern.
- **IMPORTS**: from `$lib/server/auth/totp`.
- **GOTCHA**: production should always have ENCRYPTION_KEY; this is
  a guardrail, not a feature flag — log a `console.error` server-side
  whenever the path is hit so misconfiguration is discoverable.
- **VALIDATE**: unset `ENCRYPTION_KEY`, restart dev server, visit
  `/auth/2fa` — expect notice, no 500.

#### Task 4.5: Refactor MedicationForm.svelte (P1)

- **ACTION**: Split `src/lib/components/MedicationForm.svelte` (634
  LoC) into nine sub-components under
  `src/lib/components/medication-form/`. Move state into the parent;
  pass values down via `$props()` and dispatch up via callback props
  (Svelte 5 has no DOM events for component-to-parent — use
  callbacks).
- **IMPLEMENT**: order of work:
  1. `MedicationIdentityFields.svelte` — name + interactions banner.
  2. `DosageFields.svelte` — amount/unit/form/category (4 fields).
  3. `MedicationColourPicker.svelte` — primary, secondary toggle.
  4. `MedicationPatternPreview.svelte` — pure visual, takes colour
     props.
  5. `ScheduleEditor.svelte` — owns mode + slot rows.
  6. `ScheduleRowEditor.svelte` — single time-of-day row.
  7. `InventoryFields.svelte` — count + threshold.
  8. `InteractionWarningPanel.svelte` — banner only.
  9. `MedicationForm.svelte` — assembly.
- **MIRROR**: any existing component split (e.g.,
  `InsightsCard.svelte`, `RefillsCard.svelte`) for prop shape and
  Svelte 5 runes usage.
- **IMPORTS**: relative imports inside the new dir.
- **GOTCHA**:
  - The schedules JSON is computed via `$derived.by(...)` in the
    monolith; that derivation must move with the data, not be
    reproduced in two places.
  - Don't refactor and add features in the same PR.
  - All call sites: `medications/new/+page.svelte` and
    `medications/[id]/+page.svelte` — update import paths only.
- **VALIDATE**: `npm run check` clean; `npx playwright test
  medication-flow` still green; manual: add medication looks
  identical to before.

#### Task 4.6: Inventory events table (P2)

- **ACTION**: New table `medication_inventory_events`
  (id, userId, medicationId, eventType
  ∈ {`manual_adjustment`, `dose_taken`, `dose_taken_reverted`,
  `refill`, `correction`}, deltaQuantity, resultingCount,
  occurredAt, source, notes). Write events from `logDose`,
  `deleteDose` (only when `status === "taken"`), `updateDose`
  (status-aware), and a new "refill" UI.
- **IMPLEMENT**:
  ```sql
  CREATE TABLE medication_inventory_events (
    id text PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    medication_id text NOT NULL REFERENCES medications(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    delta_quantity integer NOT NULL,
    resulting_count integer,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    source text NOT NULL,
    notes text
  );
  CREATE INDEX inv_events_med_idx ON medication_inventory_events (medication_id, occurred_at DESC);
  ```
  Schema:
  ```typescript
  export const medicationInventoryEvents = pgTable(/* … */);
  export type InventoryEventType =
    | "manual_adjustment"
    | "dose_taken"
    | "dose_taken_reverted"
    | "refill"
    | "correction";
  ```
- **MIRROR**: `auditLogs` table shape.
- **IMPORTS**: existing `medications`, `users` foreign keys.
- **GOTCHA**:
  - Phase 4 not Phase 1: don't block correctness work on this.
  - Backfill is **not** required — events start from migration
    deploy.
- **VALIDATE**: log a dose → row in `medication_inventory_events`
  with `event_type = "dose_taken"`, `delta_quantity = -quantity`.

#### Task 4.7: Drop redundant deps (P2)

- **ACTION**: Confirm whether the `playwright` package (separate from
  `@playwright/test`) is required. If unused, remove. Same audit for
  `sharp` (README flagged).
- **IMPLEMENT**:
  ```bash
  rg "from ['\"]playwright['\"]" --type ts
  rg "require\\(['\"]playwright['\"]\\)" --type js
  ```
  If zero hits → `npm uninstall playwright`. Same for `sharp`.
- **MIRROR**: nothing.
- **IMPORTS**: nothing.
- **GOTCHA**: `@playwright/test` re-exports browser drivers; the
  bare `playwright` package is rarely needed when `@playwright/test`
  is present. But verify before removing.
- **VALIDATE**: `npm run test:e2e` green after removal.

---

## Testing Strategy

### Unit Tests — new

| Test file | Covers | Edge cases |
|---|---|---|
| `tests/unit/reminders-dedupe.test.ts` | `buildOverdueDedupeKey`, `buildLowInventoryDedupeKey`, `isScheduleOverdue` | Day-of-week mismatch; tolerance window; never-taken interval |
| `tests/unit/doses-inventory.test.ts` | `deleteDose`, `updateDose` status branches | Skipped delete; skipped edit; mismatched user |
| `tests/unit/analytics-lifecycle.test.ts` | Lifecycle window in expected-doses table | Pre-start; post-end; null endedAt |

### E2E Tests — new

| Test file | Covers |
|---|---|
| `tests/e2e/auth.test.ts` | Register + login + forgot password |
| `tests/e2e/medication-flow.test.ts` | Add med → schedule → log → edit → skip |
| `tests/e2e/history-export.test.ts` | Filter + CSV download |
| `tests/e2e/analytics.test.ts` | Charts render with seeded data |
| `tests/e2e/quick-log.test.ts` | Keyboard shortcut + modal focus |
| `tests/e2e/a11y.test.ts` | axe scan of all primary pages |

### Edge Cases Checklist
- [ ] Dose with `status="missed"` (system-set) — currently no path
      writes this; assert ignored by inventory branches anyway.
- [ ] User with empty inventory (`inventoryCount = null`) — guarded by
      `isNotNull(...)` already.
- [ ] Reminder cron retried 3× in the same minute — only one
      `reminder_events` row, only one notification sent.
- [ ] Concurrent dose-log writes — Phase 2 transactions; Phase 1
      keeps `Promise.all` and accepts the race (document).
- [ ] Account-deletion grace cancellation — Task 4.3.

---

## Validation Commands

### Static Analysis
```bash
npm run check
```
EXPECT: zero TypeScript errors.

### Lint + format
```bash
npm run lint && npm run format:check
```
EXPECT: clean.

### Unit Tests
```bash
npx vitest run
```
EXPECT: all green; coverage above the current threshold for the
phase.

### Coverage
```bash
npm run test:coverage
```
EXPECT (after Phase 3 stage 3): ≥55% statements, ≥45% branches,
≥50% functions, ≥55% lines.

### E2E (Phase 3+)
```bash
npx playwright install --with-deps  # once per env
E2E_SEEDS=1 npx playwright test
```
EXPECT: all green.

### Database
```bash
npx drizzle-kit generate
npx drizzle-kit push   # local; for prod use scripts/migrate-once.mjs
```
EXPECT: clean migration; journal in sync (see memory note on
journal drift).

### Build
```bash
npm run build
```
EXPECT: succeeds with no warnings beyond existing baseline.

### Manual Validation
- [ ] Add medication, log dose, see inventory −1.
- [ ] Skip dose, see inventory unchanged.
- [ ] Delete the skipped dose, see inventory unchanged.
- [ ] Force-overdue a med (edit `taken_at` in DB), hit
  `/api/cron/reminders` twice, expect one email + one
  `reminder_events` row.
- [ ] Unset `ENCRYPTION_KEY`, visit `/auth/2fa`, see notice not 500.
- [ ] `/(app)/settings/privacy`, download data, validate JSON.
- [ ] Add medication via the new sub-component form, identical to
  before pixel-wise.

---

## Acceptance Criteria

- [ ] **Phase 1** — Reminder dedupe persists; status-aware inventory
  ships; user-scoped delete; reminder + dose unit tests; README
  re-aligned.
- [ ] **Phase 2** — Either transactions adopted on dose+inventory and
  schedule replacement, **or** Neon HTTP limitation explicitly
  documented + reconciliation. Lifecycle dates land. Analytics
  respects them.
- [ ] **Phase 3** — Six new E2E test files cover the core user flows;
  axe scan clean; coverage thresholds at ≥55/45/50/55.
- [ ] **Phase 4** — Threat model + architecture diagram + privacy
  controls page + ENCRYPTION_KEY guardrail + MedicationForm split
  into 9 sub-components + inventory events table.

## Completion Checklist

- [ ] Code follows discovered patterns (`OWNERSHIP_GUARD`,
      `FORM_ACTION`, `TEST_STRUCTURE`).
- [ ] Error handling matches codebase style (`fail(400, …)` in form
      actions; thrown errors in services).
- [ ] Logging: only `console.error` for misconfiguration; no
      `console.log` left in shipped code.
- [ ] Tests follow `tests/unit/<module>.test.ts` and
      `tests/e2e/<flow>.test.ts` convention.
- [ ] No hardcoded values (use `env.*` from `$env/dynamic/private`).
- [ ] README claims aligned with implementation.
- [ ] No scope additions beyond the four phases above.
- [ ] Self-contained — no follow-up questions during implementation.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Neon `Pool` cold-start cost on Vercel makes transactions impractical | Medium | High | Pre-flight benchmark; if regressed, fall back to "document + reconcile" path with monitoring |
| Drizzle journal drift (see memory) breaks Phase 2 migration | Medium | High | Run `scripts/migrate-once.mjs` against a scratch copy first; never push schema without journal commit |
| Refactoring `MedicationForm.svelte` regresses the schedule editor's `$derived.by` chain | Medium | Medium | Snapshot the resulting schedules JSON before/after via the existing E2E flow |
| E2E flake rate goes up sharply with auth fixtures | Medium | Medium | Use `storageState` per project; retry once in CI only |
| Privacy "delete account" surfaces irreversible action | Low | High | 7-day grace window + audit log + email confirmation |
| Coverage threshold bumps stall PRs for unrelated features | Medium | Low | Stage in three commits; revert is one line |
| In-memory dedupe removed before persistent dedupe is fully wired | Low | High | Land Task 1.1 in one commit; do not delete the in-memory `Set` until the new path lands |

## Notes

- The project's plan template (`.claude/PRPs/plans/improvements-broad.plan.md`,
  `improvements-execution.plan.md`) uses a "branch / PR map" table; the
  PR strategy above mirrors that.
- Phase 1 is the only phase that touches anything user-visible
  silently; Phase 2 onwards is opt-in or behind toggles.
- The reviewer's "P0/P1/P2" priorities are preserved as task numbers
  (`1.x` is "Phase 1", `1.1`/`1.3`/`1.6` are P0).
- Memory note `project_drizzle_journal_drift` is load-bearing for
  Tasks 2.1, 2.3, 4.6: regenerate journal before any new migration.
- The `scripts/migrate-once.mjs` HTTP migrator is the production
  migration path; do not bypass it.
- Reminders dedupe Phase 1 should be released **before** anything
  that depends on idempotent notification behaviour (e.g., a future
  digest email).
