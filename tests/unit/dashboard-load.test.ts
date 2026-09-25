import { describe, it, expect, vi, beforeEach } from "vitest";
import { doseLogs, medications, medicationSchedules } from "$lib/server/db/schema";
import { fakeDb, predicateIncludes } from "./helpers/fake-db";

// The real query modules run against the shared seam, so this pins what
// loadDashboard asks the database for. The rules it composes are covered by
// dashboard-page-data.test.ts; this file proves only the wiring.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const { loadDashboard } = await import("../../src/lib/server/dashboard/load");

const TZ = "Europe/London";
// 13:30 BST on Thursday 2026-04-16.
const NOW = new Date("2026-04-16T12:30:00.000Z");
// dashboardWindow(NOW, London): projectStart is yesterday's local midnight
// (2026-04-14T23:00Z) and end is tonight's (2026-04-16T23:00Z).
const FETCH_FROM = "2026-04-14T22:00:00.000Z"; // projectStart − 1h
const FETCH_TO = "2026-04-17T01:00:00.000Z"; // end + 2h

const EPOCH = new Date("2026-01-01T00:00:00Z");

function medicationRow(id: string, name: string, sortOrder: number) {
  return {
    id,
    userId: "u1",
    name,
    dosageAmount: "500",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    lowInventoryEpisodeAt: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder,
    isArchived: false,
    archivedAt: null,
    startedAt: EPOCH,
    endedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

function scheduleRow(medicationId: string, overrides: Record<string, unknown>) {
  return {
    id: `sched-${medicationId}`,
    medicationId,
    userId: "u1",
    scheduleKind: "fixed_time",
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: EPOCH,
    effectiveTo: null,
    createdAt: EPOCH,
    ...overrides,
  };
}

function doseRow(id: string, medicationId: string, takenAt: string) {
  return {
    id,
    userId: "u1",
    medicationId,
    quantity: 1,
    status: "taken",
    takenAt: new Date(takenAt),
    loggedAt: new Date(takenAt),
    updatedAt: new Date(takenAt),
    notes: null,
    sideEffects: null,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
  };
}

const doseReads = () =>
  fakeDb.attempted.filter((c) => c.op === "select" && c.table === "dose_logs");

beforeEach(() => {
  fakeDb.reset();
  fakeDb.seed(medications, [medicationRow("med-a", "Metformin", 0)]);
  // 11:00 London is 10:00Z today.
  fakeDb.seed(medicationSchedules, [scheduleRow("med-a", { timeOfDay: "11:00" })]);
});

describe("loadDashboard", () => {
  it("reads doses over the window's fetch range, not from today's midnight", async () => {
    await loadDashboard("u1", TZ, NOW);

    const reads = doseReads();
    // The range read, and getLastDosePerMedication's all-time read.
    expect(reads).toHaveLength(2);
    const range = reads.find((c) => predicateIncludes(c.predicate, FETCH_FROM));
    expect(range).toBeDefined();
    expect(predicateIncludes(range!.predicate, FETCH_TO)).toBe(true);
    expect(predicateIncludes(range!.predicate, "u1")).toBe(true);
    // The queue in "threads fetched doses…" below depends on this order.
    expect(reads[0]).toBe(range);
  });

  it("returns the composed payload, with no legacy keys and nothing the page merges", async () => {
    const data = await loadDashboard("u1", TZ, NOW);

    expect(Object.keys(data).sort()).toEqual([
      "done",
      "earlier",
      "later",
      "medications",
      "nextRefreshAt",
      "now",
      "status",
      "timezone",
      "today",
      "todayStart",
    ]);
    expect(data).not.toHaveProperty("timingStatus");
    expect(data.now).toBe(NOW.toISOString());
    expect(data.timezone).toBe(TZ);
    expect(data.todayStart).toBe("2026-04-15T23:00:00.000Z");
    // 11:00 BST (10:00Z) is two and a half hours before NOW.
    expect(data.today.map((c) => c.rows.map((r) => [r.expectedTime, r.state]))).toEqual([
      [["2026-04-16T10:00:00.000Z", "overdue"]],
    ]);
  });

  it("threads fetched doses and last-dose anchors into the composition", async () => {
    fakeDb.seed(medications, [
      medicationRow("med-a", "Metformin", 0),
      medicationRow("med-b", "Amlodipine", 1),
    ]);
    fakeDb.seed(medicationSchedules, [
      scheduleRow("med-a", { timeOfDay: "11:00" }),
      scheduleRow("med-b", { scheduleKind: "interval", intervalHours: "8" }),
    ]);
    // Two dose_logs reads, in loadDashboard's Promise.all order: the range
    // read, then the all-time last-dose read (strings, as the raw SQL returns).
    fakeDb.seedQueue(doseLogs, [
      [
        doseRow("d-a", "med-a", "2026-04-16T10:05:00.000Z"),
        doseRow("d-b", "med-b", "2026-04-16T02:05:00.000Z"),
      ],
      [
        {
          medicationId: "med-a",
          lastTakenAt: "2026-04-16T10:05:00.000Z",
          lastEventAt: "2026-04-16T10:05:00.000Z",
        },
        {
          medicationId: "med-b",
          lastTakenAt: "2026-04-16T02:05:00.000Z",
          lastEventAt: "2026-04-16T02:05:00.000Z",
        },
      ],
    ]);

    const data = await loadDashboard("u1", TZ, NOW);

    // med-a: d-a (10:05Z) is 5m from the 10:00Z slot, so pass 1 resolves it.
    // med-b: the 8h grid anchors on lastTakenAt 02:05Z, giving 02:05 (pass 0
    // gives it d-b), 10:05 (2h25m late) and 18:05 (Later). Without the
    // anchor, the grid would start at local midnight (23:00Z).
    expect(data.today.map((c) => [c.medicationId, c.rows.map((r) => r.expectedTime)])).toEqual([
      ["med-b", ["2026-04-16T10:05:00.000Z"]],
    ]);
    expect(data.done.map((r) => [r.key, r.covers])).toEqual([
      ["d-b", []],
      ["d-a", ["2026-04-16T10:00:00.000Z"]],
    ]);
  });
});
