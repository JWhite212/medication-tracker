# Per-Medication Notification Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each medication override the account-wide notification settings — on/off, email vs push, overdue vs low-inventory — and let an overdue reminder re-notify on a bounded cadence until the dose is logged or skipped.

**Architecture:** Five nullable columns on `medications` (`NULL` = inherit the global preference) resolved by one pure function that both reminder sweeps consume. Phase 2 appends a bounded, derived ordinal to the existing dedupe key so a slot can mint more than one reminder without the key churning without limit — the failure mode that caused the #110 revert.

**Tech Stack:** SvelteKit (Svelte 5 runes), Drizzle ORM + Neon Postgres, Zod, Vitest, PGlite for SQL-semantics tests.

**Spec:** `docs/superpowers/specs/2026-08-21-per-medication-notifications-design.md`

## Global Constraints

- **Never re-derive resolution at a call site.** `resolveChannels` in `src/lib/server/notifications/resolve.ts` is the single owner. Both sweeps consume it.
- **`NULL` means inherit.** Use `??`, never `||`. `false || true` is `true`, which would make an explicit "off" fall through to a `true` global — the single most likely bug in Phase 1.
- **Do NOT add a `db.select()` call to `checkOverdueMedications`.** `tests/unit/reminders.test.ts` keeps a deliberate bespoke fake that dispatches on **select call index** (`callIndex === 0 ? scheduleRows : lastEventRows`) and asserts on `whereArgsByCall[1]`, which is the last-event aggregate query. A third select shifts that index and makes the assertion silently test the wrong query. Extend the existing joins instead.
- **The push wire format is frozen against renames.** New `PushPayload` fields must be additive and optional.
- **PGlite test files require:** `// @vitest-environment node` on line 1, `vi.mock("$lib/server/db", ...)` before importing production code, and fixtures seeded `seedUser` → `seedMedication` → `seedSchedule`/`seedDose` (real FKs are enforced).
- **Use `fake-db` unless the behaviour is decided by the database.** A predicate that gates whether a write happens, or SQL semantics a fixture cannot model, goes in `tests/unit/pg/`.
- **Logic lives in `src/lib/**`,** not in route files — coverage thresholds (`vite.config.ts:29-34`) only count `src/lib/\*\*`.
- **Commit messages carry no AI/Claude attribution** (per the repo's global preferences).
- **Bounds:** `MIN_REPEAT_MINUTES = 1`, `MAX_REPEAT_MINUTES = 1440`, `MAX_OFFSET_MINUTES = 720`, `MAX_NAG_REPEATS = 10`.

## Deviation from the spec (deliberate, and why)

The spec says per-medication fields "serialize into one hidden JSON input following the `schedules` idiom" because `Object.fromEntries` collapses repeated field names.

**That reasoning does not apply here and the plan uses plain named fields instead.** The `schedules` field needs JSON because a medication has _many_ schedule rows sharing one field name. The notification settings are five _uniquely named_ scalars on a form that edits exactly one medication, so nothing repeats and nothing collapses. A hidden JSON input would add serialization, parsing and a failure mode for no benefit.

The JSON idiom would only become necessary if these settings later moved to a multi-medication page. Task 20 records this in the spec.

## File Structure

**Created:**

| File                                                                     | Responsibility                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `src/lib/server/notifications/resolve.ts`                                | Pure resolution of per-medication overrides against global preferences. No I/O. |
| `src/lib/components/medication-form/MedicationNotificationFields.svelte` | The notification section of the medication form. Presentational only.           |
| `tests/unit/notifications-resolve.test.ts`                               | Pure tests for resolution precedence.                                           |
| `tests/unit/pg/reminders-notification-gate.test.ts`                      | PGlite tests for the SQL coalesce gate.                                         |
| `tests/unit/pg/reminders-nag-series.test.ts`                             | PGlite tests for claiming consecutive nag keys.                                 |
| `tests/unit/medication-notification-schema.test.ts`                      | Zod tri-state and bounds tests.                                                 |
| `drizzle/00NN_*.sql`                                                     | Two generated migrations (Phase 1, Phase 2).                                    |

**Exact names of existing test files that get extended.** Verified against the tree — get these wrong and the task silently creates a duplicate suite:

`tests/unit/createMedicationWithSchedules.test.ts` and `tests/unit/updateMedicationWithSchedules.test.ts` (the medication write tests are split by function; **there is no `tests/unit/medications.test.ts`**), `tests/unit/medication-form-state.test.ts`, `tests/unit/reminders.test.ts`, `tests/unit/reminders-dedupe.test.ts`, `tests/unit/api/serialize.test.ts`, `tests/unit/import-apply.test.ts`, `tests/unit/import-round-trip.test.ts`, `tests/unit/push-payload.test.ts`, `tests/unit/helpers/pg-db.test.ts`.

Import tests are flat files named `tests/unit/import-*.test.ts`; **there is no `tests/unit/import/` directory**, so run them with the glob `npx vitest run tests/unit/import-*.test.ts`.

**Modified:**

| File                                       | Change                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/lib/server/db/schema.ts`              | 8 columns on `medications`.                                                  |
| `src/lib/server/reminders.ts`              | Both sweeps: select the override columns, gate in SQL, resolve per row.      |
| `src/lib/server/reminders/domain.ts`       | `NagPolicy`, `computeNagIndex`, `nagIndex` param on `buildOverdueDedupeKey`. |
| `src/lib/utils/validation.ts`              | `triStateField`, 8 fields on `medicationSchema`.                             |
| `src/lib/server/medications.ts`            | 8 fields in the create/update column enumerations.                           |
| `src/lib/components/MedicationForm.svelte` | Render the new section; pass values through.                                 |
| `src/lib/components/MedicationCard.svelte` | "Muted" badge.                                                               |
| `src/lib/utils/push-payload.ts`            | Optional `renotify` field; pass through in `toNotification`.                 |
| `src/routes/api/cron/reminders/+server.ts` | `reminder_events` retention purge.                                           |
| `tests/unit/helpers/pg-db.ts`              | `seedPreferences` fixture.                                                   |
| `tests/unit/reminders.test.ts`             | Widen fixtures for the new columns.                                          |
| `tests/unit/reminders-dedupe.test.ts`      | Nag-ordinal tests.                                                           |
| `tests/unit/helpers/pg-db.test.ts`         | Assert the new columns exist after migration.                                |

---

# PHASE 1 — Per-medication control

Ships independently on today's 30-minute tick. Tasks 1–10.

---

### Task 1: Pin the current contract before touching anything

The #110 post-mortem: _"The tests that pinned the old contract were deleted, then the behaviour they protected was changed. 753 green tests proved nothing."_ This task builds the harness that attempt lacked. These tests must pass on **unmodified** code, then be proven capable of failing.

**Files:**

- Modify: `tests/unit/reminders-dedupe.test.ts`

**Interfaces:**

- Consumes: `buildOverdueDedupeKey(userId, medicationId, scheduleKind, scheduleId, nextDueAt)` from `src/lib/server/reminders/domain.ts`
- Produces: nothing consumed by later tasks; a regression net.

- [ ] **Step 1: Add characterization tests for the current key format**

Append to `tests/unit/reminders-dedupe.test.ts`:

```ts
describe("overdue dedupe key — pinned contract (pre-nag-ordinal)", () => {
  const slot = new Date("2026-05-01T08:00:00.000Z");

  it("has exactly six colon-separated segments and no nag suffix", () => {
    const key = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", slot);
    expect(key).toBe("u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z");
  });

  it("one slot yields exactly one key, so a slot reminds once", () => {
    const a = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", slot);
    const b = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", slot);
    expect(a).toBe(b);
  });

  it("a fixed-time slot stays fixed as `now` advances", () => {
    // This is the #110 invariant. isOutstanding returned the most recent
    // ELAPSED occurrence, which advanced by one interval every interval;
    // the slot is part of the dedupe key, so the key churned without
    // bound and claimReminderSlot never suppressed the repeat.
    const row = fixedTimeRow({ timeOfDay: "08:00", lastEventAt: null });
    const early = computeOverdueSlot(row, new Date("2026-05-01T09:00:00.000Z"));
    const late = computeOverdueSlot(row, new Date("2026-05-01T14:00:00.000Z"));
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(late!.toISOString()).toBe(early!.toISOString());
  });

  it("an interval slot is a fixed instant derived from the last event", () => {
    const row = intervalRow({
      intervalHours: "6",
      lastEventAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const early = computeOverdueSlot(row, new Date("2026-05-01T07:00:00.000Z"));
    const late = computeOverdueSlot(row, new Date("2026-05-01T20:00:00.000Z"));
    expect(early!.toISOString()).toBe("2026-05-01T06:00:00.000Z");
    expect(late!.toISOString()).toBe("2026-05-01T06:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run them and verify they PASS on unmodified code**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: PASS. These are characterization tests — they describe what the code does today.

- [ ] **Step 3: Mutation-prove the slot-stability test**

A test that has never been red proves nothing. Temporarily edit `src/lib/server/reminders/domain.ts`, in the `fixed_time` branch, changing `return slotUtc;` to `return new Date(now);`.

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: FAIL on "a fixed-time slot stays fixed as `now` advances".

**Revert the edit** (`git checkout src/lib/server/reminders/domain.ts`) and re-run to confirm green.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/reminders-dedupe.test.ts
git commit -m "test(reminders): pin the one-key-per-slot contract before adding nags"
```

---

### Task 2: Phase 1 schema columns, migration, and the preferences fixture

**Files:**

- Modify: `src/lib/server/db/schema.ts:87-89`
- Create: `drizzle/00NN_*.sql` (generated)
- Modify: `tests/unit/helpers/pg-db.ts`
- Modify: `tests/unit/helpers/pg-db.test.ts`

**Interfaces:**

- Produces: `medications.notificationsEnabled: boolean`, `medications.notifyOverdueEmail | notifyOverduePush | notifyLowInventoryEmail | notifyLowInventoryPush: boolean | null`; `pgDb.seedPreferences(overrides?)`.

- [ ] **Step 1: Add the columns**

In `src/lib/server/db/schema.ts`, inside the `medications` table definition, immediately after `inventoryAlertThreshold: integer("inventory_alert_threshold"),`:

```ts
    // Per-medication notification overrides.
    //
    // NULL means "inherit the account-wide setting on user_preferences".
    // A plain boolean cannot express "unset": every new medication would
    // need configuring up front, and flipping the global toggle would
    // silently stop affecting medications created before the change.
    //
    // notificationsEnabled is a real boolean, not a tri-state — it is the
    // per-medication kill switch and false beats every other column.
    notificationsEnabled: boolean("notifications_enabled").notNull().default(true),
    notifyOverdueEmail: boolean("notify_overdue_email"),
    notifyOverduePush: boolean("notify_overdue_push"),
    notifyLowInventoryEmail: boolean("notify_low_inventory_email"),
    notifyLowInventoryPush: boolean("notify_low_inventory_push"),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: a new `drizzle/00NN_<name>.sql` containing five `ALTER TABLE "medications" ADD COLUMN` statements.

Open the generated file and confirm `notifications_enabled` has `DEFAULT true NOT NULL` and the other four are plain nullable booleans. Every default reproduces today's behaviour, so no backfill is needed.

- [ ] **Step 3: Add the `seedPreferences` fixture**

The overdue query INNER JOINs `user_preferences`. Without a preferences row a PGlite reminder test returns **zero rows and passes vacuously**, so this fixture is a correctness requirement, not a convenience.

In `tests/unit/helpers/pg-db.ts`, after `seedMedication` (order matters — it references `users`):

```ts
/** Seed after the user. The overdue sweep INNER JOINs user_preferences,
    so a reminder test without this row returns zero rows and passes
    vacuously — the fixture exists to make that failure impossible. */
export async function seedPreferences(
  overrides: Partial<typeof schema.userPreferences.$inferInsert> = {},
) {
  const row: typeof schema.userPreferences.$inferInsert = {
    userId: "u1",
    ...overrides,
  };
  await database.insert(schema.userPreferences).values(row).onConflictDoNothing();
  return row;
}
```

Add `seedPreferences` to the `pgDb` export object.

- [ ] **Step 4: Assert the migration applies and the columns exist**

In `tests/unit/helpers/pg-db.test.ts`, add:

```ts
it("applies the per-medication notification columns", async () => {
  const res = await pgDb.client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_name = 'medications' and column_name like 'notif%'`,
  );
  const names = res.rows.map((r) => r.column_name).sort();
  expect(names).toEqual([
    "notifications_enabled",
    "notify_low_inventory_email",
    "notify_low_inventory_push",
    "notify_overdue_email",
    "notify_overdue_push",
  ]);
});
```

- [ ] **Step 5: Run the helper tests**

Run: `npx vitest run tests/unit/helpers/pg-db.test.ts`
Expected: PASS, including the new column assertion.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/db/schema.ts drizzle/ tests/unit/helpers/pg-db.ts tests/unit/helpers/pg-db.test.ts
git commit -m "feat(db): per-medication notification override columns"
```

---

### Task 3: The resolution function

**Files:**

- Create: `src/lib/server/notifications/resolve.ts`
- Create: `tests/unit/notifications-resolve.test.ts`

**Interfaces:**

- Produces: `resolveChannels(med, prefs) => EffectiveChannels`, plus the types `MedicationNotificationOverrides`, `GlobalNotificationPreferences`, `EffectiveChannels`. Tasks 4 and 5 consume all of these.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/notifications-resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resolveChannels,
  type MedicationNotificationOverrides,
  type GlobalNotificationPreferences,
} from "$lib/server/notifications/resolve";

const ALL_GLOBAL_ON: GlobalNotificationPreferences = {
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
};

const ALL_GLOBAL_OFF: GlobalNotificationPreferences = {
  overdueEmailReminders: false,
  overduePushReminders: false,
  lowInventoryEmailAlerts: false,
  lowInventoryPushAlerts: false,
};

const NO_OVERRIDES: MedicationNotificationOverrides = {
  notificationsEnabled: true,
  notifyOverdueEmail: null,
  notifyOverduePush: null,
  notifyLowInventoryEmail: null,
  notifyLowInventoryPush: null,
};

describe("resolveChannels", () => {
  it("inherits every global when no override is set", () => {
    expect(resolveChannels(NO_OVERRIDES, ALL_GLOBAL_ON)).toEqual({
      overdueEmail: true,
      overduePush: true,
      lowInventoryEmail: true,
      lowInventoryPush: true,
    });
  });

  it("inherits a false global just as faithfully", () => {
    expect(resolveChannels(NO_OVERRIDES, ALL_GLOBAL_OFF)).toEqual({
      overdueEmail: false,
      overduePush: false,
      lowInventoryEmail: false,
      lowInventoryPush: false,
    });
  });

  it("an explicit false override beats a true global", () => {
    // The `||` bug. `false || true` is true, which would silently ignore
    // every "mute this medication's email" the user ever sets. This is the
    // single most likely defect in the feature.
    const med = { ...NO_OVERRIDES, notifyOverdueEmail: false };
    expect(resolveChannels(med, ALL_GLOBAL_ON).overdueEmail).toBe(false);
  });

  it("an explicit true override beats a false global", () => {
    const med = { ...NO_OVERRIDES, notifyOverduePush: true };
    expect(resolveChannels(med, ALL_GLOBAL_OFF).overduePush).toBe(true);
  });

  it("overrides are independent — one does not leak into another", () => {
    const med = { ...NO_OVERRIDES, notifyOverdueEmail: false };
    const out = resolveChannels(med, ALL_GLOBAL_ON);
    expect(out.overdueEmail).toBe(false);
    expect(out.overduePush).toBe(true);
    expect(out.lowInventoryEmail).toBe(true);
    expect(out.lowInventoryPush).toBe(true);
  });

  it("the kill switch forces all four off regardless of overrides", () => {
    const med: MedicationNotificationOverrides = {
      notificationsEnabled: false,
      notifyOverdueEmail: true,
      notifyOverduePush: true,
      notifyLowInventoryEmail: true,
      notifyLowInventoryPush: true,
    };
    expect(resolveChannels(med, ALL_GLOBAL_ON)).toEqual({
      overdueEmail: false,
      overduePush: false,
      lowInventoryEmail: false,
      lowInventoryPush: false,
    });
  });

  it("returns a fresh object each call", () => {
    // Callers must not be able to mutate a shared constant into every
    // other medication's result.
    const a = resolveChannels({ ...NO_OVERRIDES, notificationsEnabled: false }, ALL_GLOBAL_ON);
    const b = resolveChannels({ ...NO_OVERRIDES, notificationsEnabled: false }, ALL_GLOBAL_ON);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/notifications-resolve.test.ts`
Expected: FAIL — cannot resolve `$lib/server/notifications/resolve`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/server/notifications/resolve.ts`:

```ts
/**
 * Sole owner of "does this medication actually notify on this channel?".
 *
 * Both reminder sweeps consume this; neither re-derives it. The same
 * discipline as expectedPerDayFor and dailyRateFor — the quantity has one
 * owner precisely because two independent spellings of it drifted apart
 * once already.
 *
 * Pure. No I/O, no database, no clock.
 */

/** Only the medication columns resolution reads. */
export type MedicationNotificationOverrides = {
  notificationsEnabled: boolean;
  notifyOverdueEmail: boolean | null;
  notifyOverduePush: boolean | null;
  notifyLowInventoryEmail: boolean | null;
  notifyLowInventoryPush: boolean | null;
};

/** Only the user_preferences columns resolution reads. */
export type GlobalNotificationPreferences = {
  overdueEmailReminders: boolean;
  overduePushReminders: boolean;
  lowInventoryEmailAlerts: boolean;
  lowInventoryPushAlerts: boolean;
};

export type EffectiveChannels = {
  overdueEmail: boolean;
  overduePush: boolean;
  lowInventoryEmail: boolean;
  lowInventoryPush: boolean;
};

/**
 * Resolve one medication's effective channels.
 *
 * `??` is load-bearing and `||` is a bug: a column is `null` when the user
 * has expressed no preference and `false` when they have explicitly muted
 * the channel. `false || global` returns the global, silently discarding
 * the mute. `false ?? global` returns false, which is the whole feature.
 */
export function resolveChannels(
  med: MedicationNotificationOverrides,
  prefs: GlobalNotificationPreferences,
): EffectiveChannels {
  if (!med.notificationsEnabled) {
    return {
      overdueEmail: false,
      overduePush: false,
      lowInventoryEmail: false,
      lowInventoryPush: false,
    };
  }
  return {
    overdueEmail: med.notifyOverdueEmail ?? prefs.overdueEmailReminders,
    overduePush: med.notifyOverduePush ?? prefs.overduePushReminders,
    lowInventoryEmail: med.notifyLowInventoryEmail ?? prefs.lowInventoryEmailAlerts,
    lowInventoryPush: med.notifyLowInventoryPush ?? prefs.lowInventoryPushAlerts,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/notifications-resolve.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation-prove the `??` test**

Change `med.notifyOverdueEmail ?? prefs.overdueEmailReminders` to `med.notifyOverdueEmail || prefs.overdueEmailReminders`.

Run: `npx vitest run tests/unit/notifications-resolve.test.ts`
Expected: FAIL on "an explicit false override beats a true global".

Restore the `??` and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/notifications/resolve.ts tests/unit/notifications-resolve.test.ts
git commit -m "feat(notifications): resolve per-medication overrides against global prefs"
```

---

### Task 4: Gate the overdue sweep

**Files:**

- Modify: `src/lib/server/reminders.ts:33-62` (select + where), `:101-160` (loop)
- Modify: `tests/unit/reminders.test.ts`
- Create: `tests/unit/pg/reminders-notification-gate.test.ts`

**Interfaces:**

- Consumes: `resolveChannels`, `MedicationNotificationOverrides`, `GlobalNotificationPreferences` from Task 3.
- Produces: nothing new exported.

- [ ] **Step 1: Add the PGlite gate test (fails first)**

The WHERE clause is decided by the database, so this belongs on PGlite, not the fake.

Create `tests/unit/pg/reminders-notification-gate.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/email", () => ({
  sendReminderEmail: vi.fn(async () => ({ ok: true })),
  sendLowInventoryEmail: vi.fn(async () => ({ ok: true })),
  isEmailConfigured: () => false,
}));
vi.mock("$lib/server/push", () => ({
  sendPushNotification: vi.fn(async () => ({ ok: true })),
  hasPushSubscriptions: vi.fn(async () => false),
}));

import { pgDb } from "../helpers/pg-db";
import { reminderEvents } from "../../../src/lib/server/db/schema";

const { checkOverdueMedications } = await import("../../../src/lib/server/reminders");

async function claimedKeys(): Promise<string[]> {
  const rows = await pgDb.db.select().from(reminderEvents);
  return rows.map((r) => r.dedupeKey);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  await pgDb.seedPreferences();
});

describe("overdue sweep — per-medication gate", () => {
  it("still reminds a medication with no overrides set", async () => {
    // The LEFT-JOIN trap in reverse: the gate must not drop the common
    // case, which is every medication that has never been configured.
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(1);
  });

  it("skips a medication whose kill switch is off", async () => {
    await pgDb.seedMedication({ id: "m1", notificationsEnabled: false });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(0);
  });

  it("skips a medication that has muted both overdue channels", async () => {
    await pgDb.seedMedication({
      id: "m1",
      notifyOverdueEmail: false,
      notifyOverduePush: false,
    });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(0);
  });

  it("reminds a medication that opted INTO push while the global is off", async () => {
    await pgDb.reset();
    await pgDb.seedUser({ timezone: "UTC" });
    await pgDb.seedPreferences({
      overdueEmailReminders: false,
      overduePushReminders: false,
    });
    await pgDb.seedMedication({ id: "m1", notifyOverduePush: true });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkOverdueMedications();

    expect(await claimedKeys()).toHaveLength(1);
  });

  it("gates each medication independently", async () => {
    await pgDb.seedMedication({ id: "m1", notificationsEnabled: false });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });
    await pgDb.seedMedication({ id: "m2", name: "Other" });
    await pgDb.seedSchedule({ id: "s2", medicationId: "m2", timeOfDay: "00:01" });

    await checkOverdueMedications();

    const keys = await claimedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain("m2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/pg/reminders-notification-gate.test.ts`
Expected: FAIL — the kill-switch and mute tests claim a row because no gate exists yet.

- [ ] **Step 3: Extend the select and the WHERE**

In `src/lib/server/reminders.ts`, add to the `.select({...})` object of the schedule query, after `userOverduePushReminders`:

```ts
      userLowInventoryEmailAlerts: userPreferences.lowInventoryEmailAlerts,
      userLowInventoryPushAlerts: userPreferences.lowInventoryPushAlerts,
      medNotificationsEnabled: medications.notificationsEnabled,
      medNotifyOverdueEmail: medications.notifyOverdueEmail,
      medNotifyOverduePush: medications.notifyOverduePush,
      medNotifyLowInventoryEmail: medications.notifyLowInventoryEmail,
      medNotifyLowInventoryPush: medications.notifyLowInventoryPush,
```

Replace the `.where(...)` block with:

```ts
    .where(
      and(
        eq(medications.isArchived, false),
        ne(medicationSchedules.scheduleKind, "prn"),
        eq(medications.notificationsEnabled, true),
        // coalesce, not a bare column test. `m.notify_overdue_email = true`
        // is false for every medication that has never been configured,
        // which is almost all of them — the same shape of mistake as
        // putting a child predicate in the WHERE of a LEFT JOIN.
        or(
          sql`coalesce(${medications.notifyOverdueEmail}, ${userPreferences.overdueEmailReminders})`,
          sql`coalesce(${medications.notifyOverduePush}, ${userPreferences.overduePushReminders})`,
        ),
      ),
    );
```

`sql` is already imported at `reminders.ts:1`.

- [ ] **Step 4: Resolve inside the loop**

Add the import at the top of `src/lib/server/reminders.ts`:

```ts
import { resolveChannels } from "./notifications/resolve";
```

In `checkOverdueMedications`, immediately after `if (!slot) continue;`:

```ts
const channels = resolveChannels(
  {
    notificationsEnabled: row.medNotificationsEnabled,
    notifyOverdueEmail: row.medNotifyOverdueEmail,
    notifyOverduePush: row.medNotifyOverduePush,
    notifyLowInventoryEmail: row.medNotifyLowInventoryEmail,
    notifyLowInventoryPush: row.medNotifyLowInventoryPush,
  },
  {
    overdueEmailReminders: row.userOverdueEmailReminders,
    overduePushReminders: row.userOverduePushReminders,
    lowInventoryEmailAlerts: row.userLowInventoryEmailAlerts,
    lowInventoryPushAlerts: row.userLowInventoryPushAlerts,
  },
);
```

Then replace the two uses of the raw preference columns:

- `const emailConfigured = row.userOverdueEmailReminders && ...` becomes `const emailConfigured = channels.overdueEmail && emailGloballyConfigured && row.userEmailVerified;`
- `{ email: emailConfigured, push: row.userOverduePushReminders }` becomes `{ email: emailConfigured, push: channels.overduePush }`
- `if (row.userOverduePushReminders) { pushConfigured = await hasPushSubscriptions(...) }` becomes `if (channels.overduePush) { ... }`

Leave the comment above `withReminderClaim` about passing raw opt-in rather than the post-probe value intact — `channels.overduePush` is still the pre-probe intent, so the reasoning is unchanged.

- [ ] **Step 5: Widen the fake-db fixtures**

`resolveChannels` reads five fields that the existing fixture does not set; `notificationsEnabled: undefined` is falsy and would mute every test row.

In `tests/unit/reminders.test.ts`, find `pushDefaultOverdueRow` and add to the pushed row object:

```ts
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: false,
      medNotificationsEnabled: true,
      medNotifyOverdueEmail: null,
      medNotifyOverduePush: null,
      medNotifyLowInventoryEmail: null,
      medNotifyLowInventoryPush: null,
```

- [ ] **Step 6: Run the full reminder suite**

Run: `npx vitest run tests/unit/pg/reminders-notification-gate.test.ts tests/unit/reminders.test.ts tests/unit/reminders-dedupe.test.ts tests/unit/reminders-dispatch.test.ts`
Expected: PASS. In particular `whereArgsByCall[1]` still asserts on the last-event aggregate — confirm the "anchors on taken AND skipped doses" test is green, which proves no extra `db.select()` was introduced.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/reminders.ts tests/unit/reminders.test.ts tests/unit/pg/reminders-notification-gate.test.ts
git commit -m "feat(reminders): gate the overdue sweep on per-medication settings"
```

---

### Task 5: Gate the low-inventory sweep

Kept separate from Task 4 because the two sweeps have deliberately different probe semantics (low inventory probes _before_ claiming, overdue after) and a reviewer could reasonably accept one and reject the other.

**Files:**

- Modify: `src/lib/server/reminders.ts:164-191` (select + where), `:195-231` (loop)
- Modify: `tests/unit/pg/reminders-notification-gate.test.ts`

**Interfaces:**

- Consumes: `resolveChannels` from Task 3.

- [ ] **Step 1: Add the failing tests**

Append to `tests/unit/pg/reminders-notification-gate.test.ts`:

```ts
describe("low-inventory sweep — per-medication gate", () => {
  const LOW = { inventoryCount: 2, inventoryAlertThreshold: 5 };

  it("still alerts a medication with no overrides set", async () => {
    await pgDb.seedMedication({ id: "m1", ...LOW });
    await checkLowInventoryMedications();
    expect(await claimedKeys()).toHaveLength(1);
  });

  it("skips a medication whose kill switch is off", async () => {
    await pgDb.seedMedication({ id: "m1", ...LOW, notificationsEnabled: false });
    await checkLowInventoryMedications();
    expect(await claimedKeys()).toHaveLength(0);
  });

  it("mutes inventory alerts without touching overdue reminders", async () => {
    // The whole point of per-TYPE control: this medication should still
    // remind about missed doses.
    await pgDb.seedMedication({
      id: "m1",
      ...LOW,
      notifyLowInventoryEmail: false,
      notifyLowInventoryPush: false,
    });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "00:01" });

    await checkLowInventoryMedications();
    expect(await claimedKeys()).toHaveLength(0);

    await checkOverdueMedications();
    const keys = await claimedKeys();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(":overdue:");
  });
});
```

Extend the import line to `const { checkOverdueMedications, checkLowInventoryMedications } = await import(...)`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/pg/reminders-notification-gate.test.ts`
Expected: FAIL on the kill-switch and mute cases.

- [ ] **Step 3: Extend the select and WHERE**

In `checkLowInventoryMedications`, add to `.select({...})` after `userLowInventoryPushAlerts`:

```ts
      userOverdueEmailReminders: userPreferences.overdueEmailReminders,
      userOverduePushReminders: userPreferences.overduePushReminders,
      medNotificationsEnabled: medications.notificationsEnabled,
      medNotifyOverdueEmail: medications.notifyOverdueEmail,
      medNotifyOverduePush: medications.notifyOverduePush,
      medNotifyLowInventoryEmail: medications.notifyLowInventoryEmail,
      medNotifyLowInventoryPush: medications.notifyLowInventoryPush,
```

Replace the `or(...)` inside the `.where(and(...))` with:

```ts
        eq(medications.notificationsEnabled, true),
        or(
          sql`coalesce(${medications.notifyLowInventoryEmail}, ${userPreferences.lowInventoryEmailAlerts})`,
          sql`coalesce(${medications.notifyLowInventoryPush}, ${userPreferences.lowInventoryPushAlerts})`,
        ),
```

- [ ] **Step 4: Resolve inside the loop**

At the top of the `for (const med of lowMeds)` body:

```ts
const channels = resolveChannels(
  {
    notificationsEnabled: med.medNotificationsEnabled,
    notifyOverdueEmail: med.medNotifyOverdueEmail,
    notifyOverduePush: med.medNotifyOverduePush,
    notifyLowInventoryEmail: med.medNotifyLowInventoryEmail,
    notifyLowInventoryPush: med.medNotifyLowInventoryPush,
  },
  {
    overdueEmailReminders: med.userOverdueEmailReminders,
    overduePushReminders: med.userOverduePushReminders,
    lowInventoryEmailAlerts: med.userLowInventoryEmailAlerts,
    lowInventoryPushAlerts: med.userLowInventoryPushAlerts,
  },
);
```

Then replace `med.userLowInventoryEmailAlerts` with `channels.lowInventoryEmail` in the `emailWillFire` expression, and `const pushOptIn = med.userLowInventoryPushAlerts;` with `const pushOptIn = channels.lowInventoryPush;`.

Leave the pre-claim "no enabled channel can fire" gate and its comment exactly as they are — it is still correct and still specific to this sweep.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/unit/pg/reminders-notification-gate.test.ts tests/unit/reminders.test.ts`
Expected: PASS.

If `reminders.test.ts`'s low-inventory fixture (`pushLowInventoryRow`) fails, add the same seven fields to it as in Task 4 Step 5.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/reminders.ts tests/unit/reminders.test.ts tests/unit/pg/reminders-notification-gate.test.ts
git commit -m "feat(reminders): gate the low-inventory sweep on per-medication settings"
```

---

### Task 6: Validation schema

**Files:**

- Modify: `src/lib/utils/validation.ts:15-51`
- Create: `tests/unit/medication-notification-schema.test.ts`

**Interfaces:**

- Produces: `medicationSchema` gains `notificationsEnabled: boolean`, and `notifyOverdueEmail | notifyOverduePush | notifyLowInventoryEmail | notifyLowInventoryPush: boolean | null`. `MedicationInput` widens automatically (it is `z.infer<typeof medicationSchema>`), so Task 7 sees the new fields.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/medication-notification-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { medicationSchema } from "$lib/utils/validation";

const BASE = {
  name: "Test",
  dosageAmount: "1",
  dosageUnit: "mg",
  form: "tablet",
  category: "otc",
  colour: "#6366f1",
};

describe("medicationSchema — notification fields", () => {
  it("defaults to enabled with every override unset", () => {
    const parsed = medicationSchema.parse({ ...BASE });
    expect(parsed.notificationsEnabled).toBe(true);
    expect(parsed.notifyOverdueEmail).toBeNull();
    expect(parsed.notifyOverduePush).toBeNull();
    expect(parsed.notifyLowInventoryEmail).toBeNull();
    expect(parsed.notifyLowInventoryPush).toBeNull();
  });

  it('maps "inherit" to null, not false', () => {
    // null and false are different states. Collapsing them would freeze
    // the medication at whatever the global happened to be.
    const parsed = medicationSchema.parse({ ...BASE, notifyOverdueEmail: "inherit" });
    expect(parsed.notifyOverdueEmail).toBeNull();
  });

  it('maps "on" to true and "off" to false', () => {
    const on = medicationSchema.parse({ ...BASE, notifyOverduePush: "on" });
    const off = medicationSchema.parse({ ...BASE, notifyOverduePush: "off" });
    expect(on.notifyOverduePush).toBe(true);
    expect(off.notifyOverduePush).toBe(false);
  });

  it("rejects a value outside the tri-state", () => {
    const res = medicationSchema.safeParse({ ...BASE, notifyOverdueEmail: "maybe" });
    expect(res.success).toBe(false);
  });

  it("treats an unchecked notificationsEnabled checkbox as false", () => {
    // HTML checkboxes submit nothing when unchecked, and the form always
    // renders this one, so absence genuinely means the user cleared it.
    const parsed = medicationSchema.parse({ ...BASE });
    expect(parsed.notificationsEnabled).toBe(true);
    const off = medicationSchema.parse({ ...BASE, notificationsEnabled: undefined });
    expect(off.notificationsEnabled).toBe(true);
    const on = medicationSchema.parse({ ...BASE, notificationsEnabled: "on" });
    expect(on.notificationsEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/medication-notification-schema.test.ts`
Expected: FAIL — `notificationsEnabled` is undefined on the parsed object.

- [ ] **Step 3: Add `triStateField` and the fields**

In `src/lib/utils/validation.ts`, immediately above `export const medicationSchema`:

```ts
/**
 * A per-medication override that can also say "inherit the account
 * default".
 *
 * A checkbox cannot express this: `checkboxField` maps a missing field to
 * `false`, so "never configured" and "explicitly muted" would be the same
 * value. The form renders a three-option select, and a select always
 * submits, so absence only happens for an API caller that omitted it —
 * which also means inherit.
 */
const triStateField = z
  .enum(["inherit", "on", "off"])
  .default("inherit")
  .transform((v) => (v === "inherit" ? null : v === "on"));
```

Then inside `medicationSchema`, after `inventoryAlertThreshold`:

```ts
  // The kill switch defaults to ON: a medication the user never
  // configured should behave exactly as it did before this feature.
  notificationsEnabled: z
    .union([z.literal("on"), z.literal("off"), z.undefined()])
    .transform((v) => v !== "off"),
  notifyOverdueEmail: triStateField,
  notifyOverduePush: triStateField,
  notifyLowInventoryEmail: triStateField,
  notifyLowInventoryPush: triStateField,
```

Note this deliberately does **not** reuse `checkboxField`. `checkboxField` maps absence to `false`, which would mute every medication created through `/api/v1` by a client that omitted the field. Absence must mean "enabled".

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/medication-notification-schema.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the existing validation and API suites**

Run: `npx vitest run tests/unit/validation.test.ts tests/unit/api`
Expected: PASS. `upsertMedicationPayload` embeds `medicationSchema`, so the new fields reach `/api/v1` with no separate change.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/validation.ts tests/unit/medication-notification-schema.test.ts
git commit -m "feat(validation): tri-state per-medication notification fields"
```

---

### Task 7: Persist the settings

**Files:**

- Modify: `src/lib/server/medications.ts:154-170` (create), `:210-224` (update)
- Modify: `tests/unit/createMedicationWithSchedules.test.ts`
- Modify: `tests/unit/updateMedicationWithSchedules.test.ts`

**Interfaces:**

- Consumes: the widened `MedicationInput` from Task 6.

**Read before starting.** Adding `.default(...)` fields to `medicationSchema` makes them **required on the inferred output type**, so `MedicationInput` widens and every hand-built literal must supply them or fail type-check. Every production caller passes `parsed.data` straight from Zod (`medications/new/+page.server.ts:38`, `medications/[id]/+page.server.ts:69`, `api/commands.ts:99-100`), and `import/apply.ts` deliberately does not use these functions at all. So the **only** literals needing an update are the two test fixtures below. Do not add a `Partial<>` escape hatch to the signature — there is nothing to rescue, and it would let a real caller silently omit a field.

- [ ] **Step 1: Widen the existing fixtures**

`tests/unit/createMedicationWithSchedules.test.ts` already has a `baseInput` fixture and an `inserts()` helper returning `{ table, values }` from `fakeDb.committed`. Add five fields to `baseInput`:

```ts
const baseInput = {
  name: "Vitamin D",
  dosageAmount: "1000",
  dosageUnit: "IU",
  form: "tablet" as const,
  category: "supplement" as const,
  colour: "#f59e0b",
  pattern: "solid" as const,
  scheduleType: "scheduled" as const,
  scheduleIntervalHours: undefined,
  // Required on MedicationInput because the Zod fields carry defaults.
  notificationsEnabled: true,
  notifyOverdueEmail: null,
  notifyOverduePush: null,
  notifyLowInventoryEmail: null,
  notifyLowInventoryPush: null,
};
```

Apply the identical widening to `baseInput` in `tests/unit/updateMedicationWithSchedules.test.ts`.

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/createMedicationWithSchedules.test.ts`:

```ts
describe("createMedicationWithSchedules — notification settings", () => {
  it("persists the overrides on the inserted row", async () => {
    await createMedicationWithSchedules(
      "u1",
      { ...baseInput, notificationsEnabled: false, notifyOverdueEmail: true },
      [],
    );

    const med = inserts()[0].values as Record<string, unknown>;
    expect(med.notificationsEnabled).toBe(false);
    expect(med.notifyOverdueEmail).toBe(true);
  });

  it("keeps null distinct from false on the way to the database", async () => {
    // A `?? false` or `|| null` in the enumeration would collapse the
    // tri-state at the last possible moment, after every other layer
    // took care to preserve it.
    await createMedicationWithSchedules(
      "u1",
      { ...baseInput, notifyOverduePush: null, notifyLowInventoryEmail: false },
      [],
    );

    const med = inserts()[0].values as Record<string, unknown>;
    expect(med.notifyOverduePush).toBeNull();
    expect(med.notifyLowInventoryEmail).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run tests/unit/createMedicationWithSchedules.test.ts`
Expected: FAIL — the inserted values contain no notification keys.

- [ ] **Step 4: Add to both column enumerations**

In `createMedicationWithSchedules`, inside `.values({...})` after `inventoryAlertThreshold`:

```ts
        notificationsEnabled: input.notificationsEnabled ?? true,
        notifyOverdueEmail: input.notifyOverdueEmail ?? null,
        notifyOverduePush: input.notifyOverduePush ?? null,
        notifyLowInventoryEmail: input.notifyLowInventoryEmail ?? null,
        notifyLowInventoryPush: input.notifyLowInventoryPush ?? null,
```

Add the identical five lines to `updateMedicationWithSchedules`'s `.set({...})`, before `updatedAt`.

`?? null` here is safe and `?? false` would not be: the input value is already `boolean | null` and `??` only fires when the caller omitted the key entirely.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/createMedicationWithSchedules.test.ts tests/unit/updateMedicationWithSchedules.test.ts`
Expected: PASS.

`createMedicationWithSchedules.test.ts` asserts the exact insert-table order inside the transaction (`expect(tables).toEqual(["medications", "medication_schedules", "audit_logs"])`). Adding columns does not add an insert, so it stays green — if it fails, the change was made in the wrong place.

- [ ] **Step 6: Verify audit coverage comes free**

Run: `npx vitest run tests/unit/audit.test.ts tests/unit/updateMedicationWithSchedules.test.ts`
Expected: PASS. `computeChanges(before, updated)` whole-row diffs, so the new columns appear in audit diffs with no change to `audit.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/medications.ts tests/unit/createMedicationWithSchedules.test.ts tests/unit/updateMedicationWithSchedules.test.ts
git commit -m "feat(medications): persist per-medication notification settings"
```

---

### Task 8: The form section

**Files:**

- Create: `src/lib/components/medication-form/MedicationNotificationFields.svelte`
- Modify: `src/lib/components/MedicationForm.svelte:12` (import), `:173-175` (render)
- Modify: `src/lib/medications/medication-form-state.ts`
- Modify: `tests/unit/medication-form-state.test.ts` (this file already exists — append to it rather than creating a second suite for the same module)

**Interfaces:**

- Produces: `deriveNotificationValue(formValue, saved)` from `medication-form-state.ts`, consumed by `MedicationForm.svelte`.

- [ ] **Step 1: Write the failing test for the state derivation**

Append to the existing `tests/unit/medication-form-state.test.ts`, adding `deriveNotificationValue` to its import from `$lib/medications/medication-form-state`:

```ts
describe("deriveNotificationValue", () => {
  it("prefers a resubmitted form value so a failed save loses nothing", () => {
    // The fixed-times bug: state that does not round-trip through
    // formValues is silently discarded on a validation failure.
    expect(deriveNotificationValue("off", true)).toBe("off");
    expect(deriveNotificationValue("inherit", true)).toBe("inherit");
  });

  it("falls back to the saved value when there is no form value", () => {
    expect(deriveNotificationValue(undefined, true)).toBe("on");
    expect(deriveNotificationValue(undefined, false)).toBe("off");
  });

  it("maps a saved null to inherit", () => {
    expect(deriveNotificationValue(undefined, null)).toBe("inherit");
  });

  it("maps a saved undefined to inherit for brand-new medications", () => {
    expect(deriveNotificationValue(undefined, undefined)).toBe("inherit");
  });

  it("ignores an unrecognised form value rather than emitting it", () => {
    expect(deriveNotificationValue("banana", false)).toBe("off");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/medication-form-state.test.ts`
Expected: FAIL — `deriveNotificationValue` is not exported.

- [ ] **Step 3: Implement the derivation**

Append to `src/lib/medications/medication-form-state.ts`:

```ts
export type NotificationChoice = "inherit" | "on" | "off";

const NOTIFICATION_CHOICES = new Set<NotificationChoice>(["inherit", "on", "off"]);

/**
 * Which option a tri-state notification select should open on.
 *
 * Precedence mirrors deriveInitialMode: a resubmitted form value wins, so
 * a validation failure elsewhere on the form does not silently discard
 * the user's notification choice, then the saved column, then inherit.
 */
export function deriveNotificationValue(
  formValue: string | undefined,
  saved: boolean | null | undefined,
): NotificationChoice {
  if (formValue !== undefined && NOTIFICATION_CHOICES.has(formValue as NotificationChoice)) {
    return formValue as NotificationChoice;
  }
  if (saved === true) return "on";
  if (saved === false) return "off";
  return "inherit";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/medication-form-state.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Create the form section component**

Create `src/lib/components/medication-form/MedicationNotificationFields.svelte`:

```svelte
<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import type { FormErrors } from "$lib/medications/medication-form-errors";
  import type { NotificationChoice } from "$lib/medications/medication-form-state";

  let {
    notificationsEnabled,
    overdueEmail,
    overduePush,
    lowInventoryEmail,
    lowInventoryPush,
    errors,
  }: {
    notificationsEnabled: boolean;
    overdueEmail: NotificationChoice;
    overduePush: NotificationChoice;
    lowInventoryEmail: NotificationChoice;
    lowInventoryPush: NotificationChoice;
    errors: FormErrors;
  } = $props();

  let enabled = $state(notificationsEnabled);

  const SELECTS: { name: string; label: string; value: NotificationChoice }[] = $derived([
    { name: "notifyOverdueEmail", label: "Missed dose — email", value: overdueEmail },
    { name: "notifyOverduePush", label: "Missed dose — push", value: overduePush },
    { name: "notifyLowInventoryEmail", label: "Low stock — email", value: lowInventoryEmail },
    { name: "notifyLowInventoryPush", label: "Low stock — push", value: lowInventoryPush },
  ]);
</script>

<fieldset class="border-glass-border rounded-lg border p-4">
  <legend class="px-2 text-sm font-medium">
    Notifications
    <Tooltip text="Overrides your account-wide notification settings for this medication only." />
  </legend>

  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      name="notificationsEnabled"
      bind:checked={enabled}
      class="accent-accent size-4 rounded"
    />
    Notify me about this medication
  </label>

  {#if enabled}
    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {#each SELECTS as field (field.name)}
        <div>
          <label for={field.name} class="mb-1 block text-sm font-medium">{field.label}</label>
          <select
            id={field.name}
            name={field.name}
            value={field.value}
            class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          >
            <option value="inherit">Use account default</option>
            <option value="on">Always</option>
            <option value="off">Never</option>
          </select>
          {#if errors[field.name]?.[0]}<p class="text-danger mt-1 text-sm">
              {errors[field.name][0]}
            </p>{/if}
        </div>
      {/each}
    </div>
  {:else}
    <!-- The selects are hidden but their values must still submit, or
         toggling the kill switch off and on again would silently reset
         every per-channel choice to inherit. -->
    {#each SELECTS as field (field.name)}
      <input type="hidden" name={field.name} value={field.value} />
    {/each}
  {/if}
</fieldset>
```

- [ ] **Step 6: Wire it into the form**

In `src/lib/components/MedicationForm.svelte`, add after the `MedicationInventoryFields` import (line 12):

```ts
import MedicationNotificationFields from "./medication-form/MedicationNotificationFields.svelte";
```

Extend the `medication-form-state` import to include `deriveNotificationValue`.

Insert between the schedule hidden inputs (ending line 173) and `<MedicationInventoryFields`:

```svelte
<MedicationNotificationFields
  notificationsEnabled={formValues["notificationsEnabled"] !== undefined
    ? formValues["notificationsEnabled"] === "on"
    : (medication?.notificationsEnabled ?? true)}
  overdueEmail={deriveNotificationValue(
    formValues["notifyOverdueEmail"],
    medication?.notifyOverdueEmail,
  )}
  overduePush={deriveNotificationValue(
    formValues["notifyOverduePush"],
    medication?.notifyOverduePush,
  )}
  lowInventoryEmail={deriveNotificationValue(
    formValues["notifyLowInventoryEmail"],
    medication?.notifyLowInventoryEmail,
  )}
  lowInventoryPush={deriveNotificationValue(
    formValues["notifyLowInventoryPush"],
    medication?.notifyLowInventoryPush,
  )}
  {errors}
/>
```

- [ ] **Step 7: Type-check and build**

Run: `npx svelte-check --threshold error`
Expected: 0 errors. If `Medication` in `src/lib/types.ts` is a hand-written type rather than inferred from the schema, add the five fields to it.

Run: `npm run build`
Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add src/lib/components/medication-form/MedicationNotificationFields.svelte src/lib/components/MedicationForm.svelte src/lib/medications/medication-form-state.ts tests/unit/medication-form-state.test.ts
git commit -m "feat(medications): per-medication notification section on the form"
```

---

### Task 9: Surface the state outside the form

**Files:**

- Modify: `src/lib/components/MedicationCard.svelte:62-76`
- Modify: `src/routes/(app)/settings/notifications/+page.server.ts`, `+page.svelte`

**Interfaces:**

- Consumes: `medications.notificationsEnabled`.

- [ ] **Step 1: Add the muted badge**

In `src/lib/components/MedicationCard.svelte`, inside the badge container `<div class="flex shrink-0 items-center gap-2">`, add **before** the existing `{#if medication.refillSeverity ...}` block:

```svelte
{#if medication.notificationsEnabled === false}
  <span
    class="bg-glass text-text-secondary rounded-full px-2 py-1 text-xs font-medium"
    title="Notifications are off for this medication"
  >
    Muted
  </span>
{/if}
```

The explicit `=== false` matters: an older cached row could have `undefined`, and `!medication.notificationsEnabled` would render "Muted" on every medication.

- [ ] **Step 2: Load the muted list on the settings page**

In `src/routes/(app)/settings/notifications/+page.server.ts`, inside `load`, add a query and return it alongside the existing payload:

```ts
const mutedMedications = await db
  .select({ id: medications.id, name: medications.name })
  .from(medications)
  .where(
    and(
      eq(medications.userId, locals.user!.id),
      eq(medications.isArchived, false),
      eq(medications.notificationsEnabled, false),
    ),
  )
  .orderBy(medications.name);
```

Import `db`, `medications`, `and` and `eq` if not already present.

- [ ] **Step 3: Render the summary**

In `src/routes/(app)/settings/notifications/+page.svelte`, after the preferences form's `GlassCard`, add:

```svelte
{#if data.mutedMedications.length > 0}
  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">Muted medications</h2>
    <p class="text-text-secondary mb-3 text-sm">
      These medications ignore the settings above. Change them on the medication itself.
    </p>
    <ul class="space-y-1 text-sm">
      {#each data.mutedMedications as med (med.id)}
        <li><a class="hover:text-accent underline" href="/medications/{med.id}">{med.name}</a></li>
      {/each}
    </ul>
  </GlassCard>
{/if}
```

This exists so the global page stops implying it is the whole story.

- [ ] **Step 4: Type-check**

Run: `npx svelte-check --threshold error`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/MedicationCard.svelte "src/routes/(app)/settings/notifications/"
git commit -m "feat(medications): surface muted medications on the card and settings page"
```

---

### Task 10: Export, import, and the API contract

**Files:**

- Modify: `src/lib/server/api/serialize.ts`, `src/lib/server/api/export.ts`
- Modify: `src/lib/server/import/types.ts`, `src/lib/utils/validation.ts` (import schema)
- Modify: `src/lib/server/import/apply.ts`
- Modify: `docs/api-v1-contract.md`

**Interfaces:**

- Consumes: the schema columns from Task 2.

- [ ] **Step 1: Write the failing round-trip test**

`serializeMedication` takes an inline object literal and `tests/unit/api/serialize.test.ts` has no shared row fixture, so spell the row out in full. Append:

```ts
it("serializes per-medication notification settings", () => {
  const out = serializeMedication({
    id: "m1",
    userId: "u1",
    name: "Paracetamol",
    dosageAmount: "500",
    dosageUnit: "mg",
    form: "tablet",
    category: "pain relief",
    colour: "#ff0000",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: "8",
    inventoryCount: 30,
    inventoryAlertThreshold: 5,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    endedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    notificationsEnabled: false,
    notifyOverdueEmail: true,
    notifyOverduePush: null,
    notifyLowInventoryEmail: false,
    notifyLowInventoryPush: null,
  });
  expect(out).toMatchObject({
    notificationsEnabled: false,
    notifyOverdueEmail: true,
    notifyOverduePush: null,
    notifyLowInventoryEmail: false,
    notifyLowInventoryPush: null,
  });
});
```

If `serializeMedication`'s parameter type does not list every field above, copy the exact literal from the existing "converts dates to ISO and keeps numeric strings (medication)" test at the top of the file and add only the five notification keys to it.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/api/serialize.test.ts`
Expected: FAIL — the serialized object omits the fields.

- [ ] **Step 3: Add the fields everywhere they are enumerated by hand**

Each of these re-lists fields explicitly, so an omission is silent rather than a type error:

1. `src/lib/server/api/serialize.ts` — add the five keys to the medication serializer **and** to its explicit parameter type.
2. `src/lib/server/api/export.ts` — add them to the `FullExport` medication shape.
3. `src/lib/server/import/types.ts` — add them to the imported-medication type.
4. `src/lib/utils/validation.ts` — add them to **`importMedicationSchema`** (that is the exact export name; it is referenced at `validation.ts:461`) as `z.boolean().nullable().optional()`, with the kill switch as `z.boolean().optional()`. Unknown keys are stripped rather than rejected, so an older backup without these fields still parses.
5. `src/lib/server/import/apply.ts` — add them to the insert enumeration, defaulting to `?? null` and `?? true`.

- [ ] **Step 4: Run the API and import suites**

Run: `npx vitest run tests/unit/api tests/unit/import-*.test.ts`
Expected: PASS. (Import tests are flat files, not a directory — `tests/unit/import` would match nothing and exit green without running anything.)

- [ ] **Step 5: Update the API contract doc**

In `docs/api-v1-contract.md`, add the five fields to §3 (serialized medication shape), note in §4 that `upsert_medication` accepts them, and add them to §5 (export body). The contract is the source of truth for the separate `medtracker-mac` repo, so an omission here is a cross-repo bug.

- [ ] **Step 6: Full suite and commit**

Run: `npx vitest run`
Expected: all green.

```bash
git add src/lib/server/api src/lib/server/import src/lib/utils/validation.ts docs/api-v1-contract.md tests/
git commit -m "feat(api): carry per-medication notification settings through sync, export and import"
```

---

**PHASE 1 SHIPPING CHECKPOINT.** Open a PR at this point. Everything below is additive and Phase 1 is independently useful. Verify before opening:

```bash
npx vitest run && npx svelte-check --threshold error && npm run build
```

---

# PHASE 2 — Custom timing and repeat-until-acted

Tasks 11–20.

---

### Task 11: Phase 2 schema columns

**Files:**

- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/00NN_*.sql`
- Modify: `tests/unit/helpers/pg-db.test.ts`

**Interfaces:**

- Produces: `medications.notifyOffsetMinutes: number`, `notifyRepeatEveryMinutes: number | null`, `notifyMaxRepeats: number`.

- [ ] **Step 1: Add the columns**

In `src/lib/server/db/schema.ts`, after `notifyLowInventoryPush`:

```ts
    // Re-notification policy. Defaults reproduce today's behaviour
    // exactly: no offset, no repeat, so a slot mints one reminder.
    //
    // notifyRepeatEveryMinutes NULL means "do not repeat". The column
    // accepts any interval; the web picker deliberately offers only what
    // the 30-minute scheduler tick can honour.
    notifyOffsetMinutes: integer("notify_offset_minutes").notNull().default(0),
    notifyRepeatEveryMinutes: integer("notify_repeat_every_minutes"),
    notifyMaxRepeats: integer("notify_max_repeats").notNull().default(3),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: three `ADD COLUMN` statements.

- [ ] **Step 3: Extend the column assertion**

In `tests/unit/helpers/pg-db.test.ts`, update the expected array to include `notify_max_repeats`, `notify_offset_minutes`, `notify_repeat_every_minutes` (keep it sorted).

- [ ] **Step 4: Run and commit**

Run: `npx vitest run tests/unit/helpers/pg-db.test.ts`
Expected: PASS.

```bash
git add src/lib/server/db/schema.ts drizzle/ tests/unit/helpers/pg-db.test.ts
git commit -m "feat(db): re-notification policy columns"
```

---

### Task 12: The nag ordinal

The highest-risk logic in the feature. Pure, so it is tested exhaustively without a database.

**Files:**

- Modify: `src/lib/server/reminders/domain.ts`
- Modify: `tests/unit/reminders-dedupe.test.ts`

**Interfaces:**

- Produces: `type NagPolicy = { offsetMinutes: number; repeatEveryMinutes: number | null; maxRepeats: number }`, `NO_REPEAT: NagPolicy`, `computeNagIndex(slot: Date, policy: NagPolicy, now: Date): number | null`, and `buildOverdueDedupeKey(..., nagIndex?: number)`. Task 13 consumes all of these.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/reminders-dedupe.test.ts`. That file already imports from `$lib/server/reminders/domain` at the top — **merge `computeNagIndex`, `NO_REPEAT` and `type NagPolicy` into that existing import** rather than adding a second one, which lint will reject:

```ts
// merged into the existing import at the top of the file:
//   computeNagIndex, NO_REPEAT, type NagPolicy

const SLOT = new Date("2026-05-01T08:00:00.000Z");
const at = (iso: string) => new Date(iso);
const policy = (over: Partial<NagPolicy> = {}): NagPolicy => ({
  offsetMinutes: 0,
  repeatEveryMinutes: null,
  maxRepeats: 3,
  ...over,
});

describe("computeNagIndex", () => {
  it("is 0 when no repeat is configured, however late", () => {
    expect(computeNagIndex(SLOT, NO_REPEAT, at("2026-05-01T08:00:00.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, NO_REPEAT, at("2026-05-01T23:00:00.000Z"))).toBe(0);
  });

  it("returns null before the offset has elapsed", () => {
    const p = policy({ offsetMinutes: 30 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:29:00.000Z"))).toBeNull();
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:30:00.000Z"))).toBe(0);
  });

  it("advances one index per repeat interval", () => {
    const p = policy({ repeatEveryMinutes: 30 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:00:00.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:29:59.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:30:00.000Z"))).toBe(1);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T09:00:00.000Z"))).toBe(2);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T09:30:00.000Z"))).toBe(3);
  });

  it("CLAMPS at maxRepeats instead of returning null", () => {
    // The whole point. A hard cutoff would LOSE reminders that fire
    // today: a 22:00 slot sits through the overnight scheduler blackout,
    // so by the 06:00 tick eight hours have elapsed. Cutting off would
    // send nothing at all for a dose that was never taken.
    const p = policy({ repeatEveryMinutes: 30, maxRepeats: 3 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T10:00:00.000Z"))).toBe(3);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T16:00:00.000Z"))).toBe(3);
    expect(computeNagIndex(SLOT, p, at("2026-05-02T04:00:00.000Z"))).toBe(3);
  });

  it("a gap in ticks skips windows rather than firing a burst", () => {
    // Two consecutive ticks 8 hours apart yield ONE index, not eight.
    const p = policy({ repeatEveryMinutes: 30, maxRepeats: 10 });
    const first = computeNagIndex(SLOT, p, at("2026-05-01T08:00:00.000Z"));
    const afterGap = computeNagIndex(SLOT, p, at("2026-05-01T16:00:00.000Z"));
    expect(first).toBe(0);
    expect(afterGap).toBe(10);
    expect(typeof afterGap).toBe("number");
  });

  it("maxRepeats 0 means exactly one reminder", () => {
    const p = policy({ repeatEveryMinutes: 30, maxRepeats: 0 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:00:00.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T20:00:00.000Z"))).toBe(0);
  });

  it("treats a sub-minute interval as no repeat rather than exploding", () => {
    // #110 blocker (4): a 0.36s interval allocated ~390k Dates per row.
    // The schema floors this at 1, so reaching here means bad data — it
    // must degrade to one reminder, never to an unbounded key space.
    const p = policy({ repeatEveryMinutes: 0, maxRepeats: 3 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T20:00:00.000Z"))).toBe(0);
    const negative = policy({ repeatEveryMinutes: -5, maxRepeats: 3 });
    expect(computeNagIndex(SLOT, negative, at("2026-05-01T20:00:00.000Z"))).toBe(0);
  });

  it("the key space for one slot is finite", () => {
    // The single property separating this feature from the #110 outage.
    const p = policy({ repeatEveryMinutes: 1, maxRepeats: 3 });
    const keys = new Set<string>();
    for (let m = 0; m < 5000; m++) {
      const idx = computeNagIndex(SLOT, p, new Date(SLOT.getTime() + m * 60_000));
      keys.add(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, idx ?? 0));
    }
    expect(keys.size).toBe(4);
  });
});

describe("buildOverdueDedupeKey — nag ordinal", () => {
  it("omits the suffix entirely at index 0, matching the pre-feature key", () => {
    expect(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 0)).toBe(
      "u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z",
    );
  });

  it("defaults to index 0 when the argument is omitted", () => {
    expect(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT)).toBe(
      buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 0),
    );
  });

  it("appends the ordinal from index 1", () => {
    expect(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 2)).toBe(
      "u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z:n2",
    );
  });

  it("different ordinals are different keys, same ordinal is the same key", () => {
    const a = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 1);
    const b = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 1);
    const c = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 2);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: FAIL — `computeNagIndex` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/server/reminders/domain.ts`:

```ts
/**
 * A medication's re-notification policy.
 *
 * `repeatEveryMinutes === null` means one reminder per slot, which is
 * what every medication did before this existed.
 */
export type NagPolicy = {
  offsetMinutes: number;
  repeatEveryMinutes: number | null;
  maxRepeats: number;
};

export const NO_REPEAT: NagPolicy = {
  offsetMinutes: 0,
  repeatEveryMinutes: null,
  maxRepeats: 0,
};

/**
 * Which reminder in a slot's series is due now, or null if none is yet.
 *
 * This is the machine #110 broke, built deliberately. There, the SLOT
 * advanced every interval, so the dedupe key churned without bound and
 * claimReminderSlot could never suppress a repeat: "one reminder per
 * interval, forever". Three properties prevent that here.
 *
 *   1. The slot is fixed. computeOverdueSlot is untouched; only this
 *      ordinal moves.
 *   2. The ordinal is BOUNDED by maxRepeats, so one slot owns at most
 *      maxRepeats + 1 keys.
 *   3. It is derived from elapsed time, not counted in a table — O(1),
 *      no loop, and a missed tick skips windows instead of firing a
 *      burst.
 *
 * It CLAMPS rather than cutting off. Returning null past the cap would
 * lose reminders that fire today: a 22:00 slot sits through the
 * overnight scheduler blackout, and by the 06:00 tick the raw index is
 * far past the cap. Saturating means the final reminder is claimed once,
 * sent once, and suppressed thereafter.
 */
export function computeNagIndex(slot: Date, policy: NagPolicy, now: Date): number | null {
  const firstNagAt = slot.getTime() + policy.offsetMinutes * 60_000;
  if (now.getTime() < firstNagAt) return null;

  // A non-positive or non-finite interval must degrade to a single
  // reminder. The schema floors it at 1, so arriving here means bad or
  // legacy data, and an unbounded key space is the one outcome that is
  // not survivable.
  const every = policy.repeatEveryMinutes;
  if (every === null || !Number.isFinite(every) || every < 1) return 0;

  const elapsed = now.getTime() - firstNagAt;
  const raw = Math.floor(elapsed / (every * 60_000));
  const cap = Number.isFinite(policy.maxRepeats) ? Math.max(0, policy.maxRepeats) : 0;
  return Math.min(raw, cap);
}
```

Then change `buildOverdueDedupeKey` to take an optional ordinal:

```ts
export function buildOverdueDedupeKey(
  userId: string,
  medicationId: string,
  scheduleKind: string,
  scheduleId: string,
  nextDueAt: Date,
  nagIndex = 0,
): string {
  const base = `${userId}:${medicationId}:overdue:${scheduleKind}:${scheduleId}:${nextDueAt.toISOString()}`;
  // Index 0 produces the pre-feature key byte-for-byte, so every
  // medication that does not repeat keeps its existing key and every
  // in-flight reminder_events row stays addressable across the deploy.
  return nagIndex > 0 ? `${base}:n${nagIndex}` : base;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: PASS, including the Task 1 characterization tests unchanged.

- [ ] **Step 5: Mutation-prove the clamp**

Change `return Math.min(raw, cap);` to `return raw > cap ? null : raw;` — the cutoff design this task exists to reject.

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: FAIL on "CLAMPS at maxRepeats instead of returning null".

Restore and re-run to confirm green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/reminders/domain.ts tests/unit/reminders-dedupe.test.ts
git commit -m "feat(reminders): bounded nag ordinal for repeat-until-acted"
```

---

### Task 13: Wire the nag series into the sweep

**Files:**

- Modify: `src/lib/server/reminders.ts`
- Create: `tests/unit/pg/reminders-nag-series.test.ts`

**Interfaces:**

- Consumes: `computeNagIndex`, `NagPolicy`, `buildOverdueDedupeKey` from Task 12.

**Touch `checkOverdueMedications` only.** Spec decision 6: the repeat policy applies to overdue reminders, and `checkLowInventoryMedications` keeps its single-shot behaviour. Its dedupe key includes the inventory count, so it already self-heals as the count changes, and re-nagging a stock warning every 30 minutes is noise rather than a reminder. Phase 1's per-medication toggles still cover both types — this is a limit on the _repeat_, not on the per-medication control.

- [ ] **Step 1: Write the failing PGlite test**

Whether a second nag is claimable is decided by `claimReminderSlot`'s `setWhere`, so this is a database question.

Create `tests/unit/pg/reminders-nag-series.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/email", () => ({
  sendReminderEmail: vi.fn(async () => ({ ok: true })),
  sendLowInventoryEmail: vi.fn(async () => ({ ok: true })),
  isEmailConfigured: () => true,
}));
vi.mock("$lib/server/push", () => ({
  sendPushNotification: vi.fn(async () => ({ ok: true })),
  hasPushSubscriptions: vi.fn(async () => false),
}));

import { pgDb } from "../helpers/pg-db";
import { reminderEvents } from "../../../src/lib/server/db/schema";

const { checkOverdueMedications } = await import("../../../src/lib/server/reminders");

async function keys(): Promise<string[]> {
  const rows = await pgDb.db.select().from(reminderEvents);
  return rows.map((r) => r.dedupeKey).sort();
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  await pgDb.seedPreferences();
  // toFake: ["Date"] only. Faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nag series", () => {
  it("mints exactly one key when no repeat is configured", async () => {
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T09:00:00.000Z"));
    await checkOverdueMedications();
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    await checkOverdueMedications();

    expect(await keys()).toHaveLength(1);
  });

  it("mints a second key once the repeat interval has elapsed", async () => {
    await pgDb.seedMedication({
      id: "m1",
      notifyRepeatEveryMinutes: 30,
      notifyMaxRepeats: 3,
    });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);

    vi.setSystemTime(new Date("2026-05-01T08:30:00.000Z"));
    await checkOverdueMedications();
    const two = await keys();
    expect(two).toHaveLength(2);
    expect(two[1]).toMatch(/:n1$/);
  });

  it("does not re-claim the same nag window twice", async () => {
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:35:00.000Z"));
    await checkOverdueMedications();
    vi.setSystemTime(new Date("2026-05-01T08:40:00.000Z"));
    await checkOverdueMedications();

    expect(await keys()).toHaveLength(1);
  });

  it("stops at maxRepeats + 1 keys however long the dose goes unlogged", async () => {
    // The bound that makes this safe. #110 had no bound and produced one
    // reminder per interval forever.
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 2 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    for (let h = 8; h <= 22; h++) {
      vi.setSystemTime(new Date(`2026-05-01T${String(h).padStart(2, "0")}:00:00.000Z`));
      await checkOverdueMedications();
      vi.setSystemTime(new Date(`2026-05-01T${String(h).padStart(2, "0")}:30:00.000Z`));
      await checkOverdueMedications();
    }

    expect(await keys()).toHaveLength(3);
  });

  it("stops the series as soon as the dose is logged", async () => {
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);

    await pgDb.seedDose({
      medicationId: "m1",
      takenAt: new Date("2026-05-01T08:10:00.000Z"),
      status: "taken",
    });

    vi.setSystemTime(new Date("2026-05-01T09:30:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);
  });

  it("claims a new nag well inside the 30-minute failure-retry cooldown", async () => {
    // The orthogonality property the spec claims and nothing else proves.
    // RETRY_DELAY_MS is 30 minutes, but it gates re-attempting a FAILED
    // send on an EXISTING row. A new nag is a new dedupe key, so it
    // inserts rather than conflicting and the cooldown never applies.
    //
    // If the ordinal had been stored as a counter on the row instead of
    // in the key, this test would fail — and a short nag interval would
    // also let an in-flight dispatch be reclaimed as an abandoned lease,
    // because RETRY_DELAY_MS doubles as the stale-pending threshold.
    //
    // 5 minutes is below the web picker's 30-minute floor on purpose:
    // the column accepts any interval, so this must hold there too.
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 5, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();
    vi.setSystemTime(new Date("2026-05-01T08:05:00.000Z"));
    await checkOverdueMedications();

    const two = await keys();
    expect(two).toHaveLength(2);
    expect(two.some((k) => k.endsWith(":n1"))).toBe(true);
  });

  it("a skip stops the series just as a taken dose does", async () => {
    await pgDb.seedMedication({ id: "m1", notifyRepeatEveryMinutes: 30, notifyMaxRepeats: 3 });
    await pgDb.seedSchedule({ id: "s1", medicationId: "m1", timeOfDay: "08:00" });

    vi.setSystemTime(new Date("2026-05-01T08:00:00.000Z"));
    await checkOverdueMedications();

    await pgDb.seedDose({
      medicationId: "m1",
      takenAt: new Date("2026-05-01T08:10:00.000Z"),
      status: "skipped",
    });

    vi.setSystemTime(new Date("2026-05-01T09:30:00.000Z"));
    await checkOverdueMedications();
    expect(await keys()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/pg/reminders-nag-series.test.ts`
Expected: FAIL — the repeat tests produce only one key.

- [ ] **Step 3: Wire it in**

In `src/lib/server/reminders.ts`, extend the schedule query's `.select({...})`:

```ts
      medNotifyOffsetMinutes: medications.notifyOffsetMinutes,
      medNotifyRepeatEveryMinutes: medications.notifyRepeatEveryMinutes,
      medNotifyMaxRepeats: medications.notifyMaxRepeats,
```

Update the import from `./reminders/domain` to add `computeNagIndex`.

Inside the loop, after `if (!slot) continue;` and the `resolveChannels` call, insert:

```ts
const nagIndex = computeNagIndex(
  slot,
  {
    offsetMinutes: row.medNotifyOffsetMinutes,
    repeatEveryMinutes: row.medNotifyRepeatEveryMinutes,
    maxRepeats: row.medNotifyMaxRepeats,
  },
  now,
);
// null means the offset has not elapsed yet — the slot is due but the
// user asked to be told later.
if (nagIndex === null) continue;
```

Change the key construction to pass it:

```ts
const dedupeKey = buildOverdueDedupeKey(
  row.userId,
  row.medicationId,
  row.scheduleKind,
  row.scheduleId,
  slot,
  nagIndex,
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/pg/reminders-nag-series.test.ts tests/unit/reminders.test.ts tests/unit/reminders-dedupe.test.ts`
Expected: PASS.

If `reminders.test.ts` fixtures fail, add `medNotifyOffsetMinutes: 0, medNotifyRepeatEveryMinutes: null, medNotifyMaxRepeats: 3` to `pushDefaultOverdueRow`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/reminders.ts tests/unit/reminders.test.ts tests/unit/pg/reminders-nag-series.test.ts
git commit -m "feat(reminders): repeat overdue reminders until the dose is logged or skipped"
```

---

### Task 14: Re-alert on a replaced notification

**Files:**

- Modify: `src/lib/utils/push-payload.ts`
- Modify: `src/lib/server/reminders.ts`
- Modify: `tests/unit/push-payload.test.ts`

**Interfaces:**

- Produces: `PushPayload.renotify?: boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/push-payload.test.ts`:

```ts
describe("toNotification — renotify", () => {
  it("passes renotify through when a tag is present", () => {
    const { options } = toNotification({
      title: "t",
      body: "b",
      url: "/dashboard",
      tag: "overdue-m1",
      renotify: true,
    });
    expect(options.renotify).toBe(true);
  });

  it("omits renotify when the payload does not ask for it", () => {
    const { options } = toNotification({ title: "t", body: "b", url: "/d", tag: "overdue-m1" });
    expect(options.renotify).toBeUndefined();
  });

  it("never sets renotify without a tag", () => {
    // renotify requires a tag; setting one without the other throws a
    // TypeError in some browsers and would kill the whole notification.
    const { options } = toNotification({ title: "t", body: "b", url: "/d", renotify: true });
    expect(options.tag).toBeUndefined();
    expect(options.renotify).toBeUndefined();
  });

  it("ignores a non-boolean renotify from the wire", () => {
    const { options } = toNotification({ title: "t", body: "b", tag: "x", renotify: "yes" });
    expect(options.renotify).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/push-payload.test.ts`
Expected: FAIL on the pass-through case.

- [ ] **Step 3: Implement**

In `src/lib/utils/push-payload.ts`, add to `PushPayload`:

```ts
  /**
   * Re-alert for a notification that replaced an earlier one with the
   * same tag. Additive and optional: the wire format is frozen against
   * renames, and a service worker predating this field simply ignores
   * it, so the replacement lands silently instead of breaking.
   */
  renotify?: boolean;
```

In `toNotification`, immediately after the existing tag line:

```ts
// renotify is only meaningful alongside a tag, and some browsers throw
// a TypeError if it is set without one — which would lose the entire
// notification, not just the re-alert.
if (options.tag && data.renotify === true) options.renotify = true;
```

- [ ] **Step 4: Set it on repeat sends**

In `src/lib/server/reminders.ts`, in the overdue push call, add:

```ts
              tag: overdueTag(row.medicationId),
              // Same tag as the previous nag, so the tray holds one entry
              // per medication rather than N. That means each nag REPLACES
              // the last, which is why the re-alert has to be explicit.
              renotify: nagIndex > 0,
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/push-payload.test.ts tests/unit/reminders.test.ts`
Expected: PASS. The tag-namespace disjointness test is unaffected — no new tag builder was added.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/push-payload.ts src/lib/server/reminders.ts tests/unit/push-payload.test.ts
git commit -m "feat(push): re-alert when a repeat reminder replaces its predecessor"
```

---

### Task 15: Reminder event retention

A slot can now own up to `maxRepeats + 1` rows instead of one.

**Files:**

- Modify: `src/routes/api/cron/reminders/+server.ts`

- [ ] **Step 1: Add the purge**

In `src/routes/api/cron/reminders/+server.ts`, add `reminderEvents` to the schema import and, after the rate-limit cleanup:

```ts
// Reminder events are an audit trail, not state: the dedupe key only
// needs to outlive its slot. A repeat policy multiplies rows per slot
// by maxRepeats + 1, so this stops being negligible.
const RETENTION_DAYS = 90;
await db
  .delete(reminderEvents)
  .where(lt(reminderEvents.sentAt, new Date(Date.now() - RETENTION_DAYS * 86_400_000)));
```

- [ ] **Step 2: Verify the endpoint still type-checks and builds**

Run: `npx svelte-check --threshold error && npm run build`
Expected: 0 errors, clean build.

- [ ] **Step 3: Commit**

```bash
git add "src/routes/api/cron/reminders/+server.ts"
git commit -m "feat(reminders): purge reminder events older than 90 days"
```

---

### Task 16: Timing validation and persistence

**Files:**

- Modify: `src/lib/utils/validation.ts`
- Modify: `src/lib/server/medications.ts`
- Modify: `tests/unit/medication-notification-schema.test.ts`

**Interfaces:**

- Produces: `medicationSchema` gains `notifyOffsetMinutes: number`, `notifyRepeatEveryMinutes: number | null`, `notifyMaxRepeats: number`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/medication-notification-schema.test.ts`:

```ts
describe("medicationSchema — timing fields", () => {
  it("defaults to no offset, no repeat, three max repeats", () => {
    const parsed = medicationSchema.parse({ ...BASE });
    expect(parsed.notifyOffsetMinutes).toBe(0);
    expect(parsed.notifyRepeatEveryMinutes).toBeNull();
    expect(parsed.notifyMaxRepeats).toBe(3);
  });

  it("treats a blank repeat interval as null, NOT as zero", () => {
    // z.coerce.number() turns "" into 0, which is the trap that already
    // mis-stores inventoryAlertThreshold. Zero here would mean an
    // interval of zero minutes, not "no repeat".
    const parsed = medicationSchema.parse({ ...BASE, notifyRepeatEveryMinutes: "" });
    expect(parsed.notifyRepeatEveryMinutes).toBeNull();
  });

  it("accepts a valid repeat interval", () => {
    const parsed = medicationSchema.parse({ ...BASE, notifyRepeatEveryMinutes: "30" });
    expect(parsed.notifyRepeatEveryMinutes).toBe(30);
  });

  it("rejects a sub-minute repeat interval", () => {
    // #110 blocker (4): no lower bound meant a fractional interval
    // allocated ~390k Dates per row.
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "0" }).success).toBe(
      false,
    );
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "0.001" }).success).toBe(
      false,
    );
  });

  it("rejects an interval beyond a day and an offset beyond twelve hours", () => {
    expect(medicationSchema.safeParse({ ...BASE, notifyRepeatEveryMinutes: "1441" }).success).toBe(
      false,
    );
    expect(medicationSchema.safeParse({ ...BASE, notifyOffsetMinutes: "721" }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    // The sweep only sees slots that have already elapsed, so a negative
    // offset could never fire early — it would be a setting that does
    // not mean what it says.
    expect(medicationSchema.safeParse({ ...BASE, notifyOffsetMinutes: "-15" }).success).toBe(false);
  });

  it("bounds maxRepeats", () => {
    expect(medicationSchema.safeParse({ ...BASE, notifyMaxRepeats: "11" }).success).toBe(false);
    expect(medicationSchema.parse({ ...BASE, notifyMaxRepeats: "0" }).notifyMaxRepeats).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/medication-notification-schema.test.ts`
Expected: FAIL — the timing fields are undefined.

- [ ] **Step 3: Implement**

In `src/lib/utils/validation.ts`, above `medicationSchema`:

```ts
export const MIN_REPEAT_MINUTES = 1;
export const MAX_REPEAT_MINUTES = 1440;
export const MAX_OFFSET_MINUTES = 720;
export const MAX_NAG_REPEATS = 10;

/**
 * Minutes, where an empty string means "not set" rather than zero.
 *
 * `z.coerce.number()` coerces "" to 0, which is the trap that already
 * mis-stores inventoryAlertThreshold. For a repeat interval the two are
 * emphatically different: null is "do not repeat" and 0 is an interval
 * of zero minutes.
 */
const optionalMinutesField = z
  .union([z.string(), z.number(), z.undefined()])
  .transform((v) => {
    if (v === undefined) return null;
    const s = typeof v === "number" ? String(v) : v.trim();
    return s === "" ? null : Number(s);
  })
  .pipe(z.union([z.null(), z.number().int().min(MIN_REPEAT_MINUTES).max(MAX_REPEAT_MINUTES)]));
```

Then inside `medicationSchema`, after the five Phase 1 fields:

```ts
  notifyOffsetMinutes: z.coerce.number().int().min(0).max(MAX_OFFSET_MINUTES).default(0),
  notifyRepeatEveryMinutes: optionalMinutesField,
  notifyMaxRepeats: z.coerce.number().int().min(0).max(MAX_NAG_REPEATS).default(3),
```

- [ ] **Step 4: Persist them**

In `src/lib/server/medications.ts`, add to **both** the `.values({...})` and `.set({...})` enumerations:

```ts
        notifyOffsetMinutes: input.notifyOffsetMinutes ?? 0,
        notifyRepeatEveryMinutes: input.notifyRepeatEveryMinutes ?? null,
        notifyMaxRepeats: input.notifyMaxRepeats ?? 3,
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/unit/medication-notification-schema.test.ts tests/unit/createMedicationWithSchedules.test.ts tests/unit/updateMedicationWithSchedules.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/validation.ts src/lib/server/medications.ts tests/unit/medication-notification-schema.test.ts
git commit -m "feat(validation): bounded re-notification timing fields"
```

---

### Task 17: Timing UI

**Files:**

- Modify: `src/lib/components/medication-form/MedicationNotificationFields.svelte`
- Modify: `src/lib/components/MedicationForm.svelte`

- [ ] **Step 1: Extend the component props**

Add to the `$props()` destructure and its type in `MedicationNotificationFields.svelte`:

```ts
offsetMinutes: string;
repeatEveryMinutes: string;
maxRepeats: string;
```

- [ ] **Step 2: Render the controls**

Inside the `{#if enabled}` block, after the grid of selects:

```svelte
<div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
  <div>
    <label for="notifyOffsetMinutes" class="mb-1 block text-sm font-medium">
      Remind me after
      <Tooltip
        text="How long after the scheduled time to send the first reminder. Reminders can only be sent after a dose is due, never before."
      />
    </label>
    <select
      id="notifyOffsetMinutes"
      name="notifyOffsetMinutes"
      value={offsetMinutes}
      class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >
      <option value="0">Straight away</option>
      <option value="30">30 minutes</option>
      <option value="60">1 hour</option>
    </select>
  </div>

  <div>
    <label for="notifyRepeatEveryMinutes" class="mb-1 block text-sm font-medium">
      Then repeat
      <Tooltip
        text="Reminders repeat until you log or skip the dose. The shortest interval available is 30 minutes, because that is how often the reminder service runs."
      />
    </label>
    <select
      id="notifyRepeatEveryMinutes"
      name="notifyRepeatEveryMinutes"
      value={repeatEveryMinutes}
      class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >
      <option value="">Don't repeat</option>
      <option value="30">Every 30 minutes</option>
      <option value="60">Every hour</option>
      <option value="120">Every 2 hours</option>
    </select>
  </div>

  <div>
    <label for="notifyMaxRepeats" class="mb-1 block text-sm font-medium">Give up after</label>
    <select
      id="notifyMaxRepeats"
      name="notifyMaxRepeats"
      value={maxRepeats}
      class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >
      <option value="1">1 reminder</option>
      <option value="2">2 reminders</option>
      <option value="3">3 reminders</option>
      <option value="5">5 reminders</option>
    </select>
  </div>
</div>
```

Add the same three fields to the `{:else}` hidden-input block so a disabled section still round-trips its values.

The picker deliberately offers nothing below 30 minutes: the scheduler ticks every 30 minutes, so a shorter interval would be a number the app cannot honour.

- [ ] **Step 3: Pass the values from the parent**

In `MedicationForm.svelte`, add to the `<MedicationNotificationFields ... />` call:

```svelte
offsetMinutes={formValues["notifyOffsetMinutes"] ??
  medication?.notifyOffsetMinutes?.toString() ??
  "0"}
repeatEveryMinutes={formValues["notifyRepeatEveryMinutes"] ??
  medication?.notifyRepeatEveryMinutes?.toString() ??
  ""}
maxRepeats={formValues["notifyMaxRepeats"] ?? medication?.notifyMaxRepeats?.toString() ?? "3"}
```

- [ ] **Step 4: Type-check and build**

Run: `npx svelte-check --threshold error && npm run build`
Expected: 0 errors, clean build.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/medication-form/MedicationNotificationFields.svelte src/lib/components/MedicationForm.svelte
git commit -m "feat(medications): re-notification timing controls on the form"
```

---

### Task 18: Carry the timing fields through the API

**Files:**

- Modify: `src/lib/server/api/serialize.ts`, `src/lib/server/api/export.ts`
- Modify: `src/lib/server/import/types.ts`, `src/lib/utils/validation.ts`, `src/lib/server/import/apply.ts`
- Modify: `docs/api-v1-contract.md`
- Modify: `tests/unit/api/serialize.test.ts`

- [ ] **Step 1: Extend the serializer test**

Add the three timing fields to the Task 10 serializer test's input and expectation:

```ts
it("serializes re-notification timing", () => {
  const out = serializeMedication({
    ...BASE_MEDICATION_ROW,
    notifyOffsetMinutes: 30,
    notifyRepeatEveryMinutes: 60,
    notifyMaxRepeats: 2,
  });
  expect(out).toMatchObject({
    notifyOffsetMinutes: 30,
    notifyRepeatEveryMinutes: 60,
    notifyMaxRepeats: 2,
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/api/serialize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the fields to all five hand-enumerated places**

Same five files as Task 10 Step 3. Import schema types: `notifyOffsetMinutes: z.number().int().optional()`, `notifyRepeatEveryMinutes: z.number().int().nullable().optional()`, `notifyMaxRepeats: z.number().int().optional()`.

- [ ] **Step 4: Run the suites**

Run: `npx vitest run tests/unit/api tests/unit/import-*.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the contract doc**

Add the three fields to §3 and §5 of `docs/api-v1-contract.md`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/api src/lib/server/import src/lib/utils/validation.ts docs/api-v1-contract.md tests/
git commit -m "feat(api): carry re-notification timing through sync, export and import"
```

---

### Task 19: Correct the stale reminder documentation

These docs are already wrong, and this feature makes two of them wronger.

**Files:**

- Modify: `docs/adr/0005-reminder-deduplication.md`
- Modify: `docs/database.md`
- Modify: `docs/architecture.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Fix ADR 0005**

The key format documented there is wrong — the correction was lost in the #112 revert. Set it to the real format and document the optional ordinal:

```
<userId>:<medicationId>:overdue:<scheduleKind>:<scheduleId>:<slotISO>[:n<index>]
```

Add a paragraph recording that the ordinal is bounded by `maxRepeats` and that this bound is what distinguishes it from the unbounded key churn that caused the #110 revert.

- [ ] **Step 2: Fix `docs/database.md`**

Remove the phantom "reminder cadence" column reference around `:92`. Correct the dedupe key at `:114` and delete the "can't fire twice" claim — a slot can now fire up to `maxRepeats + 1` times. Document the eight new `medications` columns.

- [ ] **Step 3: Fix `docs/architecture.md`**

Around `:51`, record that **two** schedulers drive the endpoint (the daily Vercel cron and the 30-minute GitHub Actions tick), not one. Around `:60`, replace the `status='claimed'` / `ON CONFLICT DO NOTHING` description with the real `ON CONFLICT DO UPDATE ... setWhere` claim/complete scheme.

- [ ] **Step 4: Update README and CHANGELOG**

Add per-medication notification control to the README feature table. Add a CHANGELOG entry — nothing about reminders has been recorded there since #69.

- [ ] **Step 5: Commit**

```bash
git add docs/ README.md CHANGELOG.md
git commit -m "docs: correct reminder dedupe, cadence and claim documentation"
```

---

### Task 20: Full verification

- [ ] **Step 1: Run everything**

```bash
npx vitest run
npx svelte-check --threshold error
npx eslint .
npm run build
```

Expected: all tests pass, 0 type errors, 0 lint errors, clean build.

- [ ] **Step 2: Confirm coverage did not regress**

Run: `npx vitest run --coverage`
Expected: statements ≥ 30, branches ≥ 25, functions ≥ 25.5, lines ≥ 30. The new logic lives in `src/lib/server/notifications/` and `src/lib/server/reminders/`, both inside `src/lib/**`, so it counts toward the floor rather than diluting it.

- [ ] **Step 3: Record the form-field decision in the spec**

Append to the spec's UI section, so the deviation is recorded where the next reader looks:

> **Correction (implementation):** the settings use plain named form fields, not a hidden JSON input. The `schedules` field needs JSON because one medication has many schedule rows sharing a field name; these five settings are uniquely named scalars on a single-medication form, so nothing collapses. The JSON idiom would only be needed if they moved to a multi-medication page.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-08-21-per-medication-notifications-design.md
git commit -m "docs(spec): record the plain-form-field decision"
```

---

## Manual verification

Automated tests cannot prove a notification arrived. After merging:

1. Set a medication to a fixed time a few minutes ahead, repeat every 30 minutes, give up after 2.
2. Wait for the tick (or trigger the GitHub Actions workflow manually via `workflow_dispatch`).
3. Confirm the first reminder arrives, a second arrives ~30 minutes later replacing it in the tray, and no third arrives after the cap.
4. Log the dose and confirm the series stops.
5. Mute a different medication and confirm it goes quiet while the first keeps reminding.
