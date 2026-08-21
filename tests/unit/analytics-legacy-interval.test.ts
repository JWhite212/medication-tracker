import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { medications } from "$lib/server/db/schema";

// getPerMedicationStats falls back to a medication's legacy
// scheduleIntervalHours column only when it has no medication_schedules
// rows (pre-migration data). Drizzle `numeric` columns arrive as
// strings, so a stored "0" is truthy and the old inline guard
// `b.scheduleIntervalHours ? 24 / Number(b.scheduleIntervalHours) : 0`
// divided by zero, producing Infinity — which flowed into expectedTotal
// and onward into getDoseStatusBreakdown's missedEvents.
const row = {
  medicationId: "m1",
  medicationName: "ZeroIntervalMed",
  colour: "#6366f1",
  scheduleIntervalHours: "0",
  scheduleType: "scheduled",
  startedAt: new Date("2026-01-01T00:00:00Z"),
  endedAt: null,
  archivedAt: null,
  status: "taken",
  events: 1,
  quantity: 1,
};

// Minimal stand-in for the `db.select(...).from(...).leftJoin(...)
// .where(...).groupBy(...)` chain getPerMedicationStats builds — mirrors
// the chainable-stub pattern in tests/unit/doses-inventory.test.ts.
// `.groupBy()` is the terminal call and is awaited directly, so it can
// resolve a plain Promise rather than needing a `.then()` on the chain.
// The database comes from the shared seam, which dispatches on real table
// identity, so the seed goes on `medications` — the aggregate is driven
// FROM there and joins dose_logs in, not the other way round.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

// No medication_schedules rows for this medication, so
// getPerMedicationStats must fall back to the legacy column.
vi.mock("$lib/server/schedules", () => ({
  getSchedulesForUser: async () => new Map(),
}));

const { getPerMedicationStats } = await import("../../src/lib/server/analytics");

beforeEach(() => {
  fakeDb.reset();
  fakeDb.seed(medications, [row]);
});

describe("getPerMedicationStats legacy interval fallback", () => {
  it('yields a finite expectedTotal for a stored "0" interval instead of Infinity', async () => {
    const stats = await getPerMedicationStats("u1", 30, "UTC", {
      from: new Date("2026-01-01T00:00:00Z"),
      to: new Date("2026-01-31T00:00:00Z"),
    });
    const stat = stats.find((s) => s.medicationId === "m1");
    expect(stat).toBeDefined();
    // Would be Infinity under the old truthiness guard on a numeric string.
    expect(stat!.expectedTotal).toBe(0);
  });
});
