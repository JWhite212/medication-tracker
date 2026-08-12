import { describe, it, expect, vi } from "vitest";

// The load-bearing test: build the exact bytes the export endpoints
// emit, feed them back through the importer, and check nothing was lost
// or mangled. Everything else in the import suite tests a piece; this
// tests that the two halves actually fit together.
//
// export-csv.ts imports $lib/server/db (neon() runs at module load), so
// it needs the standard stub. serialize.ts is type-only and pure.
vi.mock("$lib/server/db", () => ({ db: {} }));

import * as s from "../../src/lib/server/api/serialize";
import { formatUserTime } from "../../src/lib/utils/time";
import { parseBackup } from "../../src/lib/server/import/backup";
import { parseDoseCsv } from "../../src/lib/server/import/csv";
import { DOSE_CSV_HEADER } from "../../src/lib/server/import/detect";

const { escapeCsvCell } = await import("../../src/lib/server/export-csv");

const TZ = "Europe/London";
const USER_ID = "user_source";

const medicationRow = {
  id: "med_1",
  userId: USER_ID,
  name: "Sertraline",
  dosageAmount: "50",
  dosageUnit: "mg",
  form: "tablet",
  category: "prescription",
  colour: "#4f46e5",
  colourSecondary: "#22d3ee",
  pattern: "split",
  notes: "Take with food",
  scheduleType: "scheduled",
  scheduleIntervalHours: "24",
  inventoryCount: 42,
  inventoryAlertThreshold: 7,
  sortOrder: 2,
  isArchived: false,
  archivedAt: null,
  startedAt: new Date("2026-01-15T00:00:00Z"),
  endedAt: null,
  createdAt: new Date("2026-01-15T00:00:00Z"),
  updatedAt: new Date("2026-06-01T00:00:00Z"),
};

const scheduleRow = {
  id: "sched_1",
  medicationId: "med_1",
  userId: USER_ID,
  scheduleKind: "fixed_time" as const,
  timeOfDay: "08:30",
  intervalHours: null,
  daysOfWeek: [1, 3, 5],
  sortOrder: 0,
  effectiveFrom: new Date("2026-01-15T00:00:00Z"),
  effectiveTo: null,
  createdAt: new Date("2026-01-15T00:00:00Z"),
};

const doseRows = [
  {
    id: "dose_1",
    userId: USER_ID,
    medicationId: "med_1",
    quantity: 2,
    takenAt: new Date("2026-05-01T07:30:00Z"),
    loggedAt: new Date("2026-05-01T07:35:00Z"),
    notes: "with breakfast",
    sideEffects: [{ name: "Nausea", severity: "mild" as const }],
    status: "taken" as const,
    updatedAt: new Date("2026-05-01T07:35:00Z"),
  },
  {
    id: "dose_2",
    userId: USER_ID,
    medicationId: "med_1",
    quantity: 1,
    takenAt: new Date("2026-05-02T07:30:00Z"),
    loggedAt: new Date("2026-05-02T07:30:00Z"),
    notes: null,
    sideEffects: null,
    status: "missed" as const,
    updatedAt: new Date("2026-05-02T07:30:00Z"),
  },
];

const inventoryEventRow = {
  id: "evt_1",
  userId: USER_ID,
  medicationId: "med_1",
  eventType: "refill" as const,
  quantityChange: 30,
  previousCount: 12,
  newCount: 42,
  note: "monthly",
  createdAt: new Date("2026-04-01T09:00:00Z"),
};

/** Byte-for-byte what GET /api/export/full and /api/v1/export/full emit
 * (see buildFullExport -> buildSyncResponse -> serialize). */
function buildExportJson(): string {
  return JSON.stringify({
    version: 1,
    exportedAt: "2026-06-01T12:00:00.000Z",
    profile: s.toSessionUser({
      id: USER_ID,
      email: "source@example.com",
      name: "Source User",
      avatarUrl: null,
      timezone: TZ,
      twoFactorEnabled: true,
      emailVerified: true,
    }),
    preferences: s.serializePreferences({
      userId: USER_ID,
      accentColor: "#4f46e5",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      uiDensity: "compact",
      reducedMotion: true,
      overdueEmailReminders: false,
      overduePushReminders: true,
      lowInventoryEmailAlerts: true,
      lowInventoryPushAlerts: false,
      doseLogPageSize: 50,
      heatmapPeriod: 180,
      exportFormat: "csv",
      updatedAt: new Date("2026-06-01T00:00:00Z"),
    }),
    medications: [
      { ...s.serializeMedication(medicationRow), schedules: [s.serializeSchedule(scheduleRow)] },
    ],
    doseLogs: doseRows.map(s.serializeDoseLog),
    inventoryEvents: [s.serializeInventoryEvent(inventoryEventRow)],
    auditLogs: [
      s.serializeAuditLog({
        id: "aud_1",
        userId: USER_ID,
        entityType: "medication",
        entityId: "med_1",
        action: "create",
        changes: null,
        createdAt: new Date("2026-01-15T00:00:00Z"),
      }),
    ],
  });
}

describe("JSON backup round trip", () => {
  const result = parseBackup(buildExportJson());

  it("parses the real export shape", () => {
    expect(result.ok).toBe(true);
  });

  it("preserves every data-bearing medication field", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const med = result.bundle.medications[0];
    expect(med).toMatchObject({
      name: "Sertraline",
      dosageAmount: "50",
      dosageUnit: "mg",
      form: "tablet",
      category: "prescription",
      colour: "#4f46e5",
      colourSecondary: "#22d3ee",
      pattern: "split",
      notes: "Take with food",
      scheduleType: "scheduled",
      scheduleIntervalHours: "24",
      inventoryCount: 42,
      inventoryAlertThreshold: 7,
      isArchived: false,
    });
    expect(med.startedAt?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("preserves the schedule, including daysOfWeek", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].schedules[0]).toMatchObject({
      scheduleKind: "fixed_time",
      timeOfDay: "08:30",
      daysOfWeek: [1, 3, 5],
    });
  });

  it("preserves every dose as a set, since export order is not guaranteed", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // buildSyncResponse has no ORDER BY on dose_logs, so compare sets.
    const seen = new Set(
      result.bundle.doses.map((d) => `${d.takenAt.toISOString()}|${d.status}|${d.quantity}`),
    );
    expect(seen).toEqual(
      new Set(["2026-05-01T07:30:00.000Z|taken|2", "2026-05-02T07:30:00.000Z|missed|1"]),
    );
  });

  it("preserves notes and side effects", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withNotes = result.bundle.doses.find((d) => d.notes !== null);
    expect(withNotes?.notes).toBe("with breakfast");
    expect(withNotes?.sideEffects).toEqual([{ name: "Nausea", severity: "mild" }]);
  });

  it("preserves the inventory event ledger", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.inventoryEvents[0]).toMatchObject({
      eventType: "refill",
      quantityChange: 30,
      previousCount: 12,
      newCount: 42,
      note: "monthly",
    });
  });

  it("preserves preferences", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.preferences).toMatchObject({
      accentColor: "#4f46e5",
      timeFormat: "24h",
      uiDensity: "compact",
      reducedMotion: true,
      doseLogPageSize: 50,
      heatmapPeriod: 180,
      exportFormat: "csv",
    });
  });

  it("drops identity even though the export carries it", () => {
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.profile).toEqual({ name: "Source User", timezone: TZ });
    expect(JSON.stringify(result.bundle)).not.toContain(USER_ID);
    expect(JSON.stringify(result.bundle)).not.toContain("source@example.com");
  });
});

/** Byte-for-byte what generateCsvReport emits, for the same rows. */
function buildExportCsv(timeFormat: "12h" | "24h"): string {
  const lines = doseRows.map((dose) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(dose.takenAt);
    const time = formatUserTime(dose.takenAt, TZ, timeFormat);
    const sideEffects = dose.sideEffects?.map((e) => `${e.name} (${e.severity})`).join("; ") ?? "";
    return [
      escapeCsvCell(date),
      escapeCsvCell(time),
      escapeCsvCell(dose.status),
      escapeCsvCell(medicationRow.name),
      escapeCsvCell(`${medicationRow.dosageAmount}${medicationRow.dosageUnit}`),
      escapeCsvCell(dose.quantity),
      escapeCsvCell(dose.notes ?? ""),
      escapeCsvCell(sideEffects),
    ].join(",");
  });
  return [DOSE_CSV_HEADER, ...lines].join("\r\n");
}

describe("dose CSV round trip", () => {
  for (const timeFormat of ["12h", "24h"] as const) {
    describe(`exported in ${timeFormat}`, () => {
      const result = parseDoseCsv(buildExportCsv(timeFormat), TZ);

      it("parses", () => {
        expect(result.ok).toBe(true);
      });

      it("recovers the exact instant, minute-precision", () => {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const instants = result.bundle.doses.map((d) => d.takenAt.toISOString()).sort();
        expect(instants).toEqual(["2026-05-01T07:30:00.000Z", "2026-05-02T07:30:00.000Z"]);
      });

      it("recovers status, quantity, notes and side effects", () => {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const taken = result.bundle.doses.find((d) => d.status === "taken");
        expect(taken).toMatchObject({ quantity: 2, notes: "with breakfast" });
        expect(taken?.sideEffects).toEqual([{ name: "Nausea", severity: "mild" }]);
        expect(result.bundle.doses.some((d) => d.status === "missed")).toBe(true);
      });

      it("splits the fused dosage cell back apart", () => {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.bundle.medications[0]).toMatchObject({
          name: "Sertraline",
          dosageAmount: "50",
          dosageUnit: "mg",
        });
      });
    });
  }

  it("survives a note that would otherwise be read as a spreadsheet formula", () => {
    const hostileNote = "=1+1 then -2";
    const line = [
      escapeCsvCell("2026-05-01"),
      escapeCsvCell("08:30"),
      escapeCsvCell("taken"),
      escapeCsvCell("Sertraline"),
      escapeCsvCell("50mg"),
      escapeCsvCell(1),
      escapeCsvCell(hostileNote),
      escapeCsvCell(""),
    ].join(",");

    const result = parseDoseCsv([DOSE_CSV_HEADER, line].join("\r\n"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The exporter prepended "'" to neutralise the formula; the importer
    // must give back the original text, not "'=1+1 then -2".
    expect(result.bundle.doses[0].notes).toBe(hostileNote);
  });

  it("survives a medication name containing a comma and quotes", () => {
    const trickyName = 'Co-codamol 30/500, "strong"';
    const line = [
      escapeCsvCell("2026-05-01"),
      escapeCsvCell("08:30"),
      escapeCsvCell("taken"),
      escapeCsvCell(trickyName),
      escapeCsvCell("30mg"),
      escapeCsvCell(1),
      escapeCsvCell(""),
      escapeCsvCell(""),
    ].join(",");

    const result = parseDoseCsv([DOSE_CSV_HEADER, line].join("\r\n"), TZ);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.medications[0].name).toBe(trickyName);
  });
});
