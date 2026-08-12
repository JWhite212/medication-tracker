import { describe, it, expect } from "vitest";

// Pure planner — the whole reason it's split from apply.ts is that every
// interesting decision can be tested without a database.
import { buildImportPlan, planIsEmpty } from "../../src/lib/server/import/plan";
import { doseKey, ALL_SECTIONS } from "../../src/lib/server/import/types";
import type {
  AccountSnapshot,
  ImportBundle,
  ImportMedication,
  ImportDose,
} from "../../src/lib/server/import/types";

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

function dose(overrides: Partial<ImportDose> = {}): ImportDose {
  return {
    sourceMedicationId: "med_1",
    medicationName: null,
    quantity: 1,
    takenAt: new Date("2026-05-01T08:00:00Z"),
    loggedAt: null,
    notes: null,
    sideEffects: null,
    status: "taken",
    ...overrides,
  };
}

function bundle(overrides: Partial<ImportBundle> = {}): ImportBundle {
  return {
    format: "backup-json",
    exportedAt: new Date("2026-06-01T00:00:00Z"),
    profile: { name: "Source", timezone: "Europe/London" },
    preferences: { accentColor: "#ff0000" },
    medications: [med()],
    doses: [dose()],
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

const MERGE = { mode: "merge" as const, sections: { ...ALL_SECTIONS } };
const REPLACE = { mode: "replace" as const, sections: { ...ALL_SECTIONS } };

describe("buildImportPlan — merge, medication matching", () => {
  it("creates a medication that isn't in the account", () => {
    const plan = buildImportPlan(bundle(), snapshot(), MERGE);
    expect(plan.medications[0].action).toBe("create");
    expect(plan.summary.medicationsCreated).toBe(1);
  });

  it("reuses an existing medication matched by name, without changing it", () => {
    const plan = buildImportPlan(
      bundle(),
      snapshot({ medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }] }),
      MERGE,
    );
    expect(plan.medications[0].action).toBe("reuse");
    expect(plan.medications[0].existingId).toBe("existing_1");
    expect(plan.summary.medicationsCreated).toBe(0);
    expect(plan.summary.medicationsReused).toBe(1);
  });

  it("matches names case- and whitespace-insensitively", () => {
    const plan = buildImportPlan(
      bundle({ medications: [med({ name: "  SERTRALINE  " })] }),
      snapshot({ medications: [{ id: "existing_1", name: "sertraline", isArchived: false }] }),
      MERGE,
    );
    expect(plan.medications[0].action).toBe("reuse");
  });

  it("prefers an active medication over an archived namesake", () => {
    const plan = buildImportPlan(
      bundle(),
      snapshot({
        medications: [
          { id: "active_1", name: "Sertraline", isArchived: false },
          { id: "archived_1", name: "Sertraline", isArchived: true },
        ],
      }),
      MERGE,
    );
    expect(plan.medications[0].existingId).toBe("active_1");
  });

  it("appends imported medications above the user's existing sort order", () => {
    // getActiveMedications orders by sortOrder alone, so reusing the
    // file's values would interleave imports into a hand-ordered list.
    const plan = buildImportPlan(
      bundle({ medications: [med({ sortOrder: 0 }), med({ sourceId: "med_2", name: "B" })] }),
      snapshot({ maxSortOrder: 7 }),
      MERGE,
    );
    expect(plan.medications.map((m) => m.source.sortOrder)).toEqual([8, 9]);
  });
});

describe("buildImportPlan — CSV names need a decision", () => {
  const csvBundle = bundle({
    format: "dose-csv",
    medications: [med({ sourceId: null, name: "Ibuprofen" })],
    doses: [dose({ sourceMedicationId: null, medicationName: "Ibuprofen" })],
    profile: null,
    preferences: null,
  });

  it("does NOT silently invent a medication from a CSV name", () => {
    const plan = buildImportPlan(csvBundle, snapshot(), MERGE);
    expect(plan.medications[0].action).toBe("skip");
    expect(plan.unmatchedNames).toEqual(["Ibuprofen"]);
  });

  it("auto-reuses a CSV name that already matches, with no decision needed", () => {
    const plan = buildImportPlan(
      csvBundle,
      snapshot({ medications: [{ id: "existing_1", name: "Ibuprofen", isArchived: false }] }),
      MERGE,
    );
    expect(plan.medications[0].action).toBe("reuse");
    expect(plan.unmatchedNames).toEqual([]);
  });

  it("honours a 'create' decision", () => {
    const plan = buildImportPlan(csvBundle, snapshot(), {
      ...MERGE,
      nameMapping: { ibuprofen: { action: "create" } },
    });
    expect(plan.medications[0].action).toBe("create");
    expect(plan.unmatchedNames).toEqual([]);
  });

  it("honours a 'map to existing' decision", () => {
    const plan = buildImportPlan(csvBundle, snapshot(), {
      ...MERGE,
      nameMapping: { ibuprofen: { action: "map", medicationId: "chosen_1" } },
    });
    expect(plan.medications[0].action).toBe("reuse");
    expect(plan.medications[0].existingId).toBe("chosen_1");
  });

  it("honours a 'skip' decision and drops that medication's doses too", () => {
    const plan = buildImportPlan(csvBundle, snapshot(), {
      ...MERGE,
      nameMapping: { ibuprofen: { action: "skip" } },
    });
    expect(plan.medications[0].action).toBe("skip");
    expect(plan.doses[0].action).toBe("skip");
    expect(plan.summary.dosesCreated).toBe(0);
  });
});

describe("buildImportPlan — dose deduplication", () => {
  it("skips a dose that already exists on a matched medication", () => {
    const existingKey = doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1);
    const plan = buildImportPlan(
      bundle(),
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([existingKey]),
      }),
      MERGE,
    );
    expect(plan.doses[0].action).toBe("skip");
    expect(plan.doses[0].reason).toMatch(/Duplicate/);
    expect(plan.summary.dosesSkipped).toBe(1);
  });

  it("dedupes a CSV at minute granularity, because its Time column is only HH:mm", () => {
    const csvSnapshot = snapshot({
      medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
      doseKeys: new Set([
        doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1, "minute"),
      ]),
    });
    const plan = buildImportPlan(
      bundle({
        format: "dose-csv",
        medications: [med({ sourceId: null })],
        doses: [
          dose({
            sourceMedicationId: null,
            medicationName: "Sertraline",
            takenAt: new Date("2026-05-01T08:00:41Z"),
          }),
        ],
      }),
      csvSnapshot,
      MERGE,
    );
    expect(plan.doses[0].action).toBe("skip");
  });

  it("KEEPS two JSON doses in the same minute — a backup carries milliseconds", () => {
    // Bucketing a JSON backup to the minute would silently drop a split
    // dose or a quick correction logged seconds apart.
    const plan = buildImportPlan(
      bundle({
        doses: [
          dose({ takenAt: new Date("2026-05-01T08:00:05Z") }),
          dose({ takenAt: new Date("2026-05-01T08:00:41Z") }),
        ],
      }),
      snapshot(),
      MERGE,
    );
    expect(plan.summary.dosesCreated).toBe(2);
  });

  it("still dedupes a JSON dose that matches an existing row exactly", () => {
    const plan = buildImportPlan(
      bundle(),
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([
          doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1, "exact"),
        ]),
      }),
      MERGE,
    );
    expect(plan.doses[0].action).toBe("skip");
  });

  it("treats a different quantity as a different record", () => {
    const existingKey = doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1);
    const plan = buildImportPlan(
      bundle({ doses: [dose({ quantity: 3 })] }),
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([existingKey]),
      }),
      MERGE,
    );
    expect(plan.doses[0].action).toBe("create");
  });

  it("treats a different status as a different record", () => {
    const existingKey = doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1);
    const plan = buildImportPlan(
      bundle({ doses: [dose({ status: "skipped" })] }),
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([existingKey]),
      }),
      MERGE,
    );
    expect(plan.doses[0].action).toBe("create");
  });

  it("dedupes duplicates that appear twice within the same file", () => {
    const plan = buildImportPlan(bundle({ doses: [dose(), dose()] }), snapshot(), MERGE);
    expect(plan.summary.dosesCreated).toBe(1);
    expect(plan.summary.dosesSkipped).toBe(1);
  });

  it("does not confuse identical doses belonging to different medications", () => {
    const plan = buildImportPlan(
      bundle({
        medications: [med(), med({ sourceId: "med_2", name: "Other" })],
        doses: [dose(), dose({ sourceMedicationId: "med_2" })],
      }),
      snapshot(),
      MERGE,
    );
    expect(plan.summary.dosesCreated).toBe(2);
  });
});

describe("buildImportPlan — back-dating", () => {
  it("keeps the file's startedAt when it has one", () => {
    const plan = buildImportPlan(bundle(), snapshot(), MERGE);
    expect(plan.medications[0].source.startedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("back-dates a missing startedAt to the earliest imported dose", () => {
    // Left as `now`, analytics would treat every imported day as
    // "medication didn't exist yet" and score adherence against nothing.
    const plan = buildImportPlan(
      bundle({
        medications: [med({ startedAt: null })],
        doses: [
          dose({ takenAt: new Date("2026-05-10T08:00:00Z") }),
          dose({ takenAt: new Date("2026-02-03T08:00:00Z") }),
        ],
      }),
      snapshot(),
      MERGE,
    );
    expect(plan.medications[0].source.startedAt?.toISOString()).toBe("2026-02-03T08:00:00.000Z");
  });

  it("leaves startedAt null when there is nothing to back-date from", () => {
    const plan = buildImportPlan(
      bundle({ medications: [med({ startedAt: null })], doses: [] }),
      snapshot(),
      MERGE,
    );
    expect(plan.medications[0].source.startedAt).toBeNull();
  });
});

describe("buildImportPlan — inventory safety", () => {
  const withEvents = bundle({
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

  it("restores inventory events for a medication it creates", () => {
    const plan = buildImportPlan(withEvents, snapshot(), MERGE);
    expect(plan.inventoryEvents[0].action).toBe("create");
  });

  it("NEVER writes inventory events onto a medication that already exists", () => {
    // This is the rule that stops an import corrupting a working
    // account: the count and the ledger would otherwise disagree with
    // no way to tell which is right.
    const plan = buildImportPlan(
      withEvents,
      snapshot({ medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }] }),
      MERGE,
    );
    expect(plan.inventoryEvents[0].action).toBe("skip");
    expect(plan.inventoryEvents[0].reason).toMatch(/own inventory history/);
    expect(plan.warnings.join(" ")).toMatch(/not applied to medications that already exist/);
  });

  it("skips all inventory when the section is deselected", () => {
    const plan = buildImportPlan(withEvents, snapshot(), {
      mode: "merge",
      sections: { inventory: false, preferences: true, profile: true },
    });
    expect(plan.inventoryEvents[0].action).toBe("skip");
    expect(plan.summary.inventoryEventsCreated).toBe(0);
  });
});

describe("buildImportPlan — sections", () => {
  it("includes profile and preferences when selected", () => {
    const plan = buildImportPlan(bundle(), snapshot(), MERGE);
    expect(plan.profile).toEqual({ name: "Source", timezone: "Europe/London" });
    expect(plan.summary.profileUpdated).toBe(true);
    expect(plan.summary.preferencesUpdated).toBe(true);
  });

  it("drops profile and preferences when deselected", () => {
    const plan = buildImportPlan(bundle(), snapshot(), {
      mode: "merge",
      sections: { inventory: true, preferences: false, profile: false },
    });
    expect(plan.profile).toBeNull();
    expect(plan.preferences).toBeNull();
    expect(plan.summary.profileUpdated).toBe(false);
  });
});

describe("buildImportPlan — replace mode", () => {
  it("creates everything and matches nothing", () => {
    const plan = buildImportPlan(
      bundle(),
      snapshot({ medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }] }),
      REPLACE,
    );
    expect(plan.medications[0].action).toBe("create");
    expect(plan.summary.medicationsReused).toBe(0);
  });

  it("ignores existing dose keys, since those rows are about to be deleted", () => {
    const existingKey = doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1);
    const plan = buildImportPlan(
      bundle(),
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([existingKey]),
      }),
      REPLACE,
    );
    expect(plan.doses[0].action).toBe("create");
  });

  it("reports what will be deleted", () => {
    const plan = buildImportPlan(
      bundle(),
      snapshot({
        medications: [
          { id: "a", name: "A", isArchived: false },
          { id: "b", name: "B", isArchived: false },
        ],
        existingDoseCount: 412,
      }),
      REPLACE,
    );
    expect(plan.summary.medicationsDeleted).toBe(2);
    expect(plan.summary.dosesDeleted).toBe(412);
  });

  it("still dedupes duplicates within the file itself", () => {
    const plan = buildImportPlan(bundle({ doses: [dose(), dose()] }), snapshot(), REPLACE);
    expect(plan.summary.dosesCreated).toBe(1);
  });

  it("reports EMPTY when the file yielded nothing, so a replace can't wipe the account", () => {
    // Reachable without malice: export the dose CSV, open it in Excel,
    // save (Excel rewrites 2026-08-01 as 01/08/2026), re-import as
    // replace. Every row fails the date check and the file parses to
    // nothing. If planIsEmpty counted the pending deletions as "work",
    // the caller's guard would pass and the account would be deleted
    // with nothing put back.
    const plan = buildImportPlan(
      bundle({ medications: [], doses: [], profile: null, preferences: null }),
      snapshot({
        medications: [{ id: "a", name: "A", isArchived: false }],
        existingDoseCount: 4213,
      }),
      REPLACE,
    );
    expect(plan.summary.medicationsDeleted).toBe(1);
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("keeps the file's own sortOrder, since export array order is arbitrary", () => {
    // buildSyncResponse has no ORDER BY on medications, so renumbering by
    // array position would scramble the ordering the user had set.
    const plan = buildImportPlan(
      bundle({
        medications: [
          med({ sourceId: "m1", name: "Third", sortOrder: 2 }),
          med({ sourceId: "m2", name: "First", sortOrder: 0 }),
        ],
        doses: [],
      }),
      snapshot(),
      REPLACE,
    );
    expect(plan.medications.map((m) => [m.source.name, m.source.sortOrder])).toEqual([
      ["Third", 2],
      ["First", 0],
    ]);
  });
});

describe("buildImportPlan — mapping is scoped and prototype-safe", () => {
  it("does NOT apply a leftover CSV mapping to a JSON backup", () => {
    // The mapping input persists in the form across file changes; applying
    // it to a JSON backup would skip medications the user never chose.
    const plan = buildImportPlan(bundle(), snapshot(), {
      ...MERGE,
      nameMapping: { sertraline: { action: "skip" } },
    });
    expect(plan.medications[0].action).toBe("create");
  });

  it("does not let a medication named 'constructor' slip past the unmatched gate", () => {
    // A bare `nameMapping[key]` lookup resolves "constructor" through
    // Object.prototype, which is truthy, so the medication would fall
    // through to "create" without ever being offered to the user.
    const plan = buildImportPlan(
      bundle({
        format: "dose-csv",
        medications: [med({ sourceId: null, name: "constructor" })],
        doses: [],
        profile: null,
        preferences: null,
      }),
      snapshot(),
      MERGE,
    );
    expect(plan.medications[0].action).toBe("skip");
    expect(plan.unmatchedNames).toEqual(["constructor"]);
  });

  it("still reuses an existing medication named 'constructor'", () => {
    const plan = buildImportPlan(
      bundle({
        format: "dose-csv",
        medications: [med({ sourceId: null, name: "constructor" })],
        doses: [],
        profile: null,
        preferences: null,
      }),
      snapshot({ medications: [{ id: "existing_1", name: "constructor", isArchived: false }] }),
      MERGE,
    );
    expect(plan.medications[0].action).toBe("reuse");
    expect(plan.medications[0].existingId).toBe("existing_1");
  });
});

describe("planIsEmpty", () => {
  it("is true when a merge would write nothing", () => {
    const existingKey = doseKey("existing_1", new Date("2026-05-01T08:00:00Z"), "taken", 1);
    const plan = buildImportPlan(
      bundle({ profile: null, preferences: null }),
      snapshot({
        medications: [{ id: "existing_1", name: "Sertraline", isArchived: false }],
        doseKeys: new Set([existingKey]),
      }),
      MERGE,
    );
    expect(planIsEmpty(plan)).toBe(true);
  });

  it("is false when anything would be written", () => {
    expect(planIsEmpty(buildImportPlan(bundle(), snapshot(), MERGE))).toBe(false);
  });
});
