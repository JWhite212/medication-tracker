import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { fakeDb } from "./helpers/fake-db";
import { users } from "$lib/server/db/schema";

// A backup must re-import into the account that made it. Each describe
// below is one way the app's own export used to come back wrong or not at
// all: two real doses collapsing to one, a merge scrambling the user's
// medication order, a sign-up name refusing the whole file, and a stock
// count the doors accept but the import refused.

vi.mock("$lib/server/audit", () => ({
  logAudit: async () => {},
  computeChanges: () => null,
}));
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const { parseBackup } = await import("../../src/lib/server/import/backup");
const { buildImportPlan } = await import("../../src/lib/server/import/plan");
const { applyImport } = await import("../../src/lib/server/import/apply");
const { ALL_SECTIONS, doseKey } = await import("../../src/lib/server/import/types");
const { INVENTORY_COUNT_MAX, medicationSchema, adjustInventoryPayload, refillPayload } =
  await import("../../src/lib/utils/validation");

import type { AccountSnapshot, ImportBundle } from "../../src/lib/server/import/types";

type Json = Record<string, unknown>;

function medicationRow(overrides: Json = {}): Json {
  return {
    id: "med_1",
    userId: "user_source",
    name: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#123456",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: "24",
    inventoryCount: 30,
    inventoryAlertThreshold: 7,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: null,
    schedules: [],
    ...overrides,
  };
}

function doseRow(overrides: Json = {}): Json {
  return {
    id: "dose_1",
    userId: "user_source",
    medicationId: "med_1",
    quantity: 1,
    // Minute-aligned with zero seconds, as the dose dialog's
    // datetime-local input writes every edited takenAt.
    takenAt: "2026-11-01T08:00:00.000Z",
    loggedAt: "2026-11-01T08:01:00.000Z",
    notes: null,
    sideEffects: null,
    status: "taken",
    ...overrides,
  };
}

function backup(overrides: Json = {}): string {
  return JSON.stringify({
    version: 1,
    exportedAt: "2026-11-02T10:00:00.000Z",
    profile: { id: "user_source", name: "Source User", timezone: "Europe/London" },
    preferences: null,
    medications: [medicationRow()],
    doseLogs: [doseRow()],
    inventoryEvents: [],
    ...overrides,
  });
}

function parsed(text: string): ImportBundle {
  const result = parseBackup(text);
  if (!result.ok) throw new Error(`expected the backup to parse: ${result.reason}`);
  return result.bundle;
}

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    medications: [],
    doseKeys: new Set(),
    inventoryEventKeys: new Set(),
    existingDoseCount: 0,
    maxSortOrder: -1,
    ...overrides,
  };
}

function plan(bundle: ImportBundle, mode: "merge" | "replace", s = snapshot()) {
  return buildImportPlan(bundle, s, { mode, sections: { ...ALL_SECTIONS } });
}

// Two real doses: distinct ids, same medication, instant, status and
// quantity. A split dose logged as two taps, both corrected to 08:00.
const twoSameInstantDoses = backup({
  doseLogs: [doseRow({ id: "dose_a" }), doseRow({ id: "dose_b" })],
});

describe("R11 — two real doses at one instant stay two doses", () => {
  it("restores both in REPLACE mode", () => {
    const result = plan(parsed(twoSameInstantDoses), "replace");
    expect(result.summary.dosesCreated).toBe(2);
    expect(result.summary.dosesSkipped).toBe(0);
  });

  it("restores both when merged into an empty account", () => {
    const result = plan(parsed(twoSameInstantDoses), "merge");
    expect(result.summary.dosesCreated).toBe(2);
    expect(result.summary.dosesSkipped).toBe(0);
  });

  it("still collapses one row that the file lists twice (same id)", () => {
    const result = plan(
      parsed(backup({ doseLogs: [doseRow({ id: "dose_a" }), doseRow({ id: "dose_a" })] })),
      "replace",
    );
    expect(result.summary.dosesCreated).toBe(1);
    expect(result.summary.dosesSkipped).toBe(1);
    expect(result.doses[1].reason).toMatch(/more than once in this file/);
  });

  it("still dedupes against the account on a merge", () => {
    // Re-importing your own backup into the account that holds it must
    // not double every dose, ids or not: an account row shares no id with
    // the file, so the account check stays on content.
    const existing = doseKey(
      "existing_1",
      new Date("2026-11-01T08:00:00.000Z"),
      "taken",
      1,
      "exact",
    );
    const result = plan(
      parsed(twoSameInstantDoses),
      "merge",
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([existing]),
      }),
    );
    expect(result.summary.dosesCreated).toBe(0);
    expect(result.doses.every((d) => d.reason === "Duplicate — already recorded.")).toBe(true);
  });

  it("keeps content dedupe for a row with no id", () => {
    const noId = doseRow();
    delete noId.id;
    const result = plan(parsed(backup({ doseLogs: [noId, { ...noId }] })), "replace");
    expect(result.summary.dosesCreated).toBe(1);
  });
});

describe("R12 — a merge keeps the file's medication order", () => {
  // The export has no ORDER BY, so its array is in heap order, not the
  // order the user set. A merge used to number the imports by array
  // position.
  const shuffled = backup({
    medications: [
      medicationRow({ id: "m3", name: "Third", sortOrder: 2 }),
      medicationRow({ id: "m1", name: "First", sortOrder: 0 }),
      medicationRow({ id: "m2", name: "Second", sortOrder: 1 }),
    ],
    doseLogs: [],
  });

  it("offsets the file's own order above the account's highest sortOrder", () => {
    const result = plan(parsed(shuffled), "merge", snapshot({ maxSortOrder: 7 }));
    expect(result.medications.map((m) => [m.source.name, m.source.sortOrder])).toEqual([
      ["Third", 10],
      ["First", 8],
      ["Second", 9],
    ]);
  });

  it("reproduces the source order when merged into an empty account", () => {
    const result = plan(parsed(shuffled), "merge");
    const order = [...result.medications]
      .sort((a, b) => a.source.sortOrder - b.source.sortOrder)
      .map((m) => m.source.name);
    expect(order).toEqual(["First", "Second", "Third"]);
  });
});

describe("R13 — a name a sign-up door stored does not refuse the file", () => {
  function withName(name: unknown): string {
    return backup({ profile: { id: "user_source", name, timezone: "Europe/Paris" } });
  }

  it('accepts an empty name (Apple sign-in with fullName "") and keeps the medications', () => {
    const bundle = parsed(withName(""));
    expect(bundle.profile).toEqual({ name: null, timezone: "Europe/Paris" });
    expect(bundle.medications).toHaveLength(1);
    expect(bundle.doses).toHaveLength(1);
  });

  it("clamps a long OAuth display name to the settings bound", () => {
    const bundle = parsed(withName(` ${"n".repeat(150)} `));
    expect(bundle.profile?.name).toBe("n".repeat(100));
  });

  it("trims surrounding whitespace", () => {
    expect(parsed(withName("  Jamie  ")).profile?.name).toBe("Jamie");
  });

  it("leaves the importer's own name alone when the file's name is empty", async () => {
    fakeDb.reset();
    await applyImport("user_target", plan(parsed(withName("   ")), "merge"));
    const userUpdate = fakeDb.attempted.find(
      (c) =>
        c.op === "update" &&
        c.table === getTableName(users) &&
        "timezone" in (c.payload as Record<string, unknown>),
    );
    expect(userUpdate?.payload).toMatchObject({ timezone: "Europe/Paris" });
    expect(userUpdate?.payload).not.toHaveProperty("name");
  });
});

describe("N29 — the doors and the import agree on a stock count's bound", () => {
  const formBase = {
    name: "Sertraline",
    dosageAmount: "50",
    dosageUnit: "mg",
    form: "tablet",
    category: "prescription",
    colour: "#123456",
  };

  it("re-imports a count above the import's old 1,000,000 cap", () => {
    // Reachable through the edit form, `adjust_inventory`, or a run of
    // refills, none of which ever had a cap.
    expect(medicationSchema.safeParse({ ...formBase, inventoryCount: "2000000" }).success).toBe(
      true,
    );
    const bundle = parsed(
      backup({
        medications: [
          medicationRow({ inventoryCount: 2_000_000, inventoryAlertThreshold: 1_500_000 }),
        ],
        inventoryEvents: [
          {
            medicationId: "med_1",
            eventType: "manual_adjustment",
            quantityChange: 1_999_970,
            previousCount: 30,
            newCount: 2_000_000,
            note: null,
            createdAt: "2026-11-01T09:00:00.000Z",
          },
        ],
      }),
    );
    expect(bundle.medications[0].inventoryCount).toBe(2_000_000);
    expect(bundle.inventoryEvents).toHaveLength(1);
  });

  it("accepts exactly INVENTORY_COUNT_MAX at every door and at the import", () => {
    expect(INVENTORY_COUNT_MAX).toBe(2_147_483_647);
    expect(
      medicationSchema.safeParse({ ...formBase, inventoryCount: String(INVENTORY_COUNT_MAX) })
        .success,
    ).toBe(true);
    expect(
      adjustInventoryPayload.safeParse({ medicationId: "m", newCount: INVENTORY_COUNT_MAX })
        .success,
    ).toBe(true);
    expect(
      parseBackup(backup({ medications: [medicationRow({ inventoryCount: INVENTORY_COUNT_MAX })] }))
        .ok,
    ).toBe(true);
  });

  it("refuses one past it at every door and at the import", () => {
    const over = INVENTORY_COUNT_MAX + 1;
    expect(medicationSchema.safeParse({ ...formBase, inventoryCount: String(over) }).success).toBe(
      false,
    );
    expect(medicationSchema.safeParse({ ...formBase, inventoryAlertThreshold: over }).success).toBe(
      false,
    );
    expect(adjustInventoryPayload.safeParse({ medicationId: "m", newCount: over }).success).toBe(
      false,
    );
    expect(refillPayload.safeParse({ medicationId: "m", quantity: over }).success).toBe(false);
    expect(parseBackup(backup({ medications: [medicationRow({ inventoryCount: over })] })).ok).toBe(
      false,
    );
  });
});
