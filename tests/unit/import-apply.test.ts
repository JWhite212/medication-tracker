import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { fakeDb } from "./helpers/fake-db";
import {
  doseLogs,
  inventoryEvents,
  medicationSchedules,
  medications,
  userPreferences,
  users,
} from "$lib/server/db/schema";

// Records every write the writer makes, so the tests can assert not just
// "it worked" but exactly which tables were touched and with what — the
// safety properties here are about what must NOT happen (no foreign
// userId, no per-row audit spam, no delete in merge mode).
const auditCalls: Array<{
  entityType: string;
  entityId: string;
  action: string;
  changes: unknown;
}> = [];

vi.mock("$lib/server/audit", () => ({
  logAudit: async (
    _userId: string,
    entityType: string,
    entityId: string,
    action: string,
    changes: unknown,
  ) => {
    auditCalls.push({ entityType, entityId, action, changes });
  },
  computeChanges: () => null,
}));

// The database comes from the shared seam. Recorded traffic carries table
// NAMES; map them back to the real table objects so every assertion below
// still reads `i.table === medications`.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const tableByName = new Map<string, unknown>(
  [doseLogs, inventoryEvents, medicationSchedules, medications, userPreferences, users].map((t) => [
    getTableName(t),
    t as unknown,
  ]),
);

function opsOf(kind: "insert" | "update" | "delete") {
  return fakeDb.attempted
    .filter((c) => c.op === kind)
    .map((c) => ({
      table: tableByName.get(c.table),
      // The old fake normalised a single-row insert to a one-element array.
      // A write with no payload records as [] rather than [undefined].
      values: (Array.isArray(c.payload) ? c.payload : c.payload ? [c.payload] : []) as Record<
        string,
        unknown
      >[],
    }));
}

const inserts = () => opsOf("insert");
const deletes = () => opsOf("delete");
// Updates carry a single row, not an array — unwrap to match the old shape.
const updates = () =>
  opsOf("update").map((o) => ({ table: o.table, values: o.values[0] as Record<string, unknown> }));

const { applyImport } = await import("../../src/lib/server/import/apply");
const { buildImportPlan } = await import("../../src/lib/server/import/plan");
const { ALL_SECTIONS } = await import("../../src/lib/server/import/types");
import type {
  AccountSnapshot,
  ImportBundle,
  ImportMedication,
} from "../../src/lib/server/import/types";

const USER = "user_importer";

function med(overrides: Partial<ImportMedication> = {}): ImportMedication {
  return {
    sourceId: "med_1",
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
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    schedules: [
      {
        scheduleKind: "fixed_time",
        timeOfDay: "08:00",
        intervalHours: null,
        daysOfWeek: null,
        sortOrder: 0,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: null,
      },
    ],
    ...overrides,
  };
}

function bundle(overrides: Partial<ImportBundle> = {}): ImportBundle {
  return {
    format: "backup-json",
    exportedAt: null,
    profile: null,
    preferences: null,
    medications: [med()],
    doses: [
      {
        sourceMedicationId: "med_1",
        medicationName: null,
        quantity: 2,
        takenAt: new Date("2026-05-01T08:00:00Z"),
        loggedAt: null,
        notes: "hello",
        sideEffects: null,
        status: "missed",
      },
    ],
    inventoryEvents: [],
    warnings: [],
    ...overrides,
  };
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

function plan(
  b = bundle(),
  s = snapshot(),
  mode: "merge" | "replace" = "merge",
  sections = ALL_SECTIONS,
) {
  return buildImportPlan(b, s, { mode, sections: { ...sections } });
}

function rowsFor(table: unknown): Record<string, unknown>[] {
  return inserts()
    .filter((i) => i.table === table)
    .flatMap((i) => i.values);
}

beforeEach(() => {
  fakeDb.reset();
  auditCalls.length = 0;
});

describe("applyImport — ownership", () => {
  it("stamps the session user on every inserted row", async () => {
    await applyImport(USER, plan());
    const written = [
      ...rowsFor(medications),
      ...rowsFor(medicationSchedules),
      ...rowsFor(doseLogs),
    ];
    expect(written.length).toBeGreaterThan(0);
    for (const row of written) expect(row.userId).toBe(USER);
  });

  it("generates fresh ids rather than reusing the file's", async () => {
    await applyImport(USER, plan());
    const [medRow] = rowsFor(medications);
    // "med_1" is the id in the source file; writing it would collide on a
    // same-account restore and import another account's identifiers.
    expect(medRow.id).not.toBe("med_1");
    expect(String(medRow.id).length).toBeGreaterThan(10);
  });

  it("points imported doses at the newly minted medication id", async () => {
    await applyImport(USER, plan());
    const [medRow] = rowsFor(medications);
    const [doseRow] = rowsFor(doseLogs);
    expect(doseRow.medicationId).toBe(medRow.id);
  });
});

describe("applyImport — data fidelity", () => {
  it("writes the back-dated startedAt so analytics stays correct", async () => {
    await applyImport(USER, plan());
    const [medRow] = rowsFor(medications);
    expect((medRow.startedAt as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("back-dates effectiveFrom on schedules alongside the medication", async () => {
    const b = bundle({
      medications: [med({ schedules: [{ ...med().schedules[0], effectiveFrom: null }] })],
    });
    await applyImport(USER, plan(b));
    const [scheduleRow] = rowsFor(medicationSchedules);
    expect((scheduleRow.effectiveFrom as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("dual-writes the deprecated schedule columns", async () => {
    // dailyRateFor still falls back to these; dropping them would
    // silently change refill forecasts and the due badges.
    await applyImport(USER, plan());
    const [medRow] = rowsFor(medications);
    expect(medRow.scheduleType).toBe("scheduled");
    expect(medRow.scheduleIntervalHours).toBe("24");
  });

  it("writes a 'missed' status that logDose could never produce", async () => {
    await applyImport(USER, plan());
    const [doseRow] = rowsFor(doseLogs);
    expect(doseRow.status).toBe("missed");
  });

  it("keeps numeric columns as strings", async () => {
    await applyImport(USER, plan());
    const [medRow] = rowsFor(medications);
    expect(medRow.dosageAmount).toBe("50");
  });

  it("dates loggedAt from the dose, not from the import run", async () => {
    await applyImport(USER, plan());
    const [doseRow] = rowsFor(doseLogs);
    expect((doseRow.loggedAt as Date).toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });
});

describe("applyImport — inventory", () => {
  it("takes the count from the file when inventory is selected", async () => {
    await applyImport(USER, plan());
    const [medRow] = rowsFor(medications);
    expect(medRow.inventoryCount).toBe(30);
  });

  it("leaves the count unset when inventory is deselected", async () => {
    await applyImport(
      USER,
      plan(bundle(), snapshot(), "merge", {
        inventory: false,
        preferences: true,
        profile: true,
      }),
    );
    const [medRow] = rowsFor(medications);
    expect(medRow.inventoryCount).toBeNull();
    expect(medRow.inventoryAlertThreshold).toBeNull();
  });

  it("NEVER decrements inventory for imported doses", async () => {
    // logDose decrements per dose, but a backup already carries the
    // post-decrement count — replaying through it would double-count.
    await applyImport(USER, plan());
    const medicationUpdates = updates().filter((u) => u.table === medications);
    expect(medicationUpdates).toHaveLength(0);
  });

  it("does not write inventory events for a reused medication", async () => {
    const b = bundle({
      inventoryEvents: [
        {
          sourceMedicationId: "med_1",
          eventType: "refill",
          quantityChange: 30,
          previousCount: 0,
          newCount: 30,
          note: null,
          createdAt: new Date("2026-04-01T00:00:00Z"),
        },
      ],
    });
    await applyImport(
      USER,
      plan(
        b,
        snapshot({ medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }] }),
      ),
    );
    expect(rowsFor(inventoryEvents)).toHaveLength(0);
  });
});

describe("applyImport — merge vs replace", () => {
  it("DELETES NOTHING in merge mode", async () => {
    await applyImport(USER, plan());
    expect(deletes()).toHaveLength(0);
  });

  it("attaches doses to the existing row when a medication is reused", async () => {
    await applyImport(
      USER,
      plan(
        bundle(),
        snapshot({ medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }] }),
      ),
    );
    expect(rowsFor(medications)).toHaveLength(0);
    expect(rowsFor(doseLogs)[0].medicationId).toBe("existing_1");
  });

  it("deletes medications in replace mode, letting cascades take the children", async () => {
    await applyImport(USER, plan(bundle(), snapshot(), "replace"));
    expect(deletes().map((d) => d.table)).toEqual([medications]);
  });
});

describe("applyImport — sync and audit", () => {
  it("bumps syncEpoch so native clients force a full resync", async () => {
    await applyImport(USER, plan());
    const userUpdates = updates().filter((u) => u.table === users);
    expect(userUpdates.some((u) => "syncEpoch" in u.values)).toBe(true);
  });

  it("writes exactly ONE audit row, however many records came in", async () => {
    const manyDoses = Array.from({ length: 50 }, (_, i) => ({
      sourceMedicationId: "med_1",
      medicationName: null,
      quantity: 1,
      takenAt: new Date(Date.UTC(2026, 4, 1, 8, i)),
      loggedAt: null,
      notes: null,
      sideEffects: null,
      status: "taken" as const,
    }));
    await applyImport(USER, plan(bundle({ doses: manyDoses })));

    expect(rowsFor(doseLogs)).toHaveLength(50);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({ entityType: "data_import", action: "create" });
  });

  it("records the counts in the audit row", async () => {
    await applyImport(USER, plan());
    const changes = auditCalls[0].changes as Record<string, { to: unknown }>;
    expect(changes.medicationsCreated.to).toBe(1);
    expect(changes.dosesCreated.to).toBe(1);
    expect(changes.mode.to).toBe("merge");
  });
});

describe("applyImport — profile and preferences", () => {
  it("updates only name and timezone from the profile", async () => {
    const b = bundle({ profile: { name: "Restored", timezone: "Europe/Paris" } });
    await applyImport(USER, plan(b));
    const profileUpdate = updates().find((u) => u.table === users && "name" in u.values);
    expect(profileUpdate?.values).toMatchObject({ name: "Restored", timezone: "Europe/Paris" });
    expect(profileUpdate?.values).not.toHaveProperty("email");
    expect(profileUpdate?.values).not.toHaveProperty("passwordHash");
    expect(profileUpdate?.values).not.toHaveProperty("twoFactorEnabled");
  });

  it("upserts preferences rather than assuming a row exists", async () => {
    const b = bundle({ preferences: { accentColor: "#abcdef" } });
    await applyImport(USER, plan(b));
    expect(rowsFor(userPreferences)[0]).toMatchObject({ userId: USER, accentColor: "#abcdef" });
  });

  it("touches neither when both sections are deselected", async () => {
    const b = bundle({
      profile: { name: "Restored", timezone: "Europe/Paris" },
      preferences: { accentColor: "#abcdef" },
    });
    await applyImport(
      USER,
      plan(b, snapshot(), "merge", { inventory: true, preferences: false, profile: false }),
    );
    expect(rowsFor(userPreferences)).toHaveLength(0);
    expect(updates().filter((u) => u.table === users && "name" in u.values)).toHaveLength(0);
  });
});

describe("applyImport — bulk behaviour", () => {
  it("chunks large inserts instead of emitting one giant statement", async () => {
    // Postgres caps a statement at 65535 bound parameters, so a 1200-row
    // insert has to be split.
    const doses = Array.from({ length: 1200 }, (_, i) => ({
      sourceMedicationId: "med_1",
      medicationName: null,
      quantity: 1,
      takenAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
      loggedAt: null,
      notes: null,
      sideEffects: null,
      status: "taken" as const,
    }));
    await applyImport(USER, plan(bundle({ doses })));

    const doseInserts = inserts().filter((i) => i.table === doseLogs);
    expect(doseInserts).toHaveLength(3);
    expect(doseInserts.every((i) => i.values.length <= 500)).toBe(true);
    expect(rowsFor(doseLogs)).toHaveLength(1200);
  });

  it("writes nothing at all for an empty plan but still records the import", async () => {
    await applyImport(USER, plan(bundle({ medications: [], doses: [] })));
    expect(rowsFor(medications)).toHaveLength(0);
    expect(rowsFor(doseLogs)).toHaveLength(0);
    expect(auditCalls).toHaveLength(1);
  });
});
