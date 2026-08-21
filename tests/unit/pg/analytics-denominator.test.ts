// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getPerMedicationStats, getDoseStatusBreakdown, getDailyAdherenceSeries } =
  await import("../../../src/lib/server/analytics");

/**
 * The expected-doses denominator, against real Postgres.
 *
 * `getPerMedicationStats` built its rows FROM dose_logs, so a medication
 * with no doses in the window produced no row at all — it contributed
 * nothing to `expectedTotal`, and so a medication you had stopped taking
 * entirely was invisible to the average adherence stat and to the status
 * breakdown's missed count. `getDailyAdherenceSeries` derived the same
 * quantity from the medications table instead and disagreed four ways.
 *
 * These live on PGlite rather than the fake because the defect IS the join
 * semantics: whether an absent child row drops the parent is decided by the
 * database, and a captured-but-unevaluated predicate cannot show it.
 */

// Mid-window "now", so a 30-day lookback lands on clean date arithmetic.
const NOW = new Date("2026-08-21T12:00:00Z");
const MID_WINDOW = new Date("2026-08-06T12:00:00Z");
// Long before any window under test, so lifecycle clamping is never the
// variable unless a test makes it one.
const LONG_AGO = new Date("2026-01-01T00:00:00Z");

// An explicit range makes both queries use identical bounds — without it
// they compute slightly different spans and "do they agree" is untestable.
const EXPLICIT_RANGE = {
  from: new Date("2026-07-22T00:00:00Z"),
  to: new Date("2026-08-21T00:00:00Z"),
};

beforeAll(() => {
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

/** One dose a day, every day, from long before the window. */
async function seedDailyMed(id: string, overrides = {}) {
  await pgDb.seedMedication({
    id,
    name: `Med ${id}`,
    scheduleType: "scheduled",
    startedAt: LONG_AGO,
    ...overrides,
  });
  await pgDb.seedSchedule({ medicationId: id, scheduleKind: "fixed_time", timeOfDay: "08:00" });
}

describe("a scheduled medication with no doses in the window", () => {
  it("still appears in the per-medication stats, at zero adherence", async () => {
    await seedDailyMed("m1");

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    expect(stats).toHaveLength(1);
    expect(stats[0].medicationId).toBe("m1");
    expect(stats[0].doseCount).toBe(0);
    expect(stats[0].adherence).toBe(0);
    // 1/day across the full 30-day window.
    expect(stats[0].expectedTotal).toBe(30);
  });

  it("counts toward the status breakdown's expected and missed totals", async () => {
    await seedDailyMed("m1");

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC");

    expect(breakdown.expectedTotal).toBe(30);
    expect(breakdown.missedEvents).toBe(30);
    expect(breakdown.adherencePercent).toBe(0);
  });

  it("drags the average down instead of vanishing from it", async () => {
    // m1 is being taken; m2 was abandoned. The average must see both.
    await seedDailyMed("m1");
    await seedDailyMed("m2");
    await pgDb.seedDose({ medicationId: "m1", takenAt: new Date("2026-08-20T08:00:00Z") });

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    expect(stats.map((s) => s.medicationId).sort()).toEqual(["m1", "m2"]);
    expect(stats.find((s) => s.medicationId === "m2")!.expectedTotal).toBe(30);
  });

  // The specific trap in a LEFT JOIN rewrite: leave the dose_logs date
  // predicate in the WHERE clause and the join silently demotes to an inner
  // one, dropping the parent row again. Doses exist here, just not in range.
  it("appears even when its only doses fall outside the window", async () => {
    await seedDailyMed("m1");
    await pgDb.seedDose({ medicationId: "m1", takenAt: new Date("2026-01-15T08:00:00Z") });

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    expect(stats).toHaveLength(1);
    expect(stats[0].doseCount).toBe(0);
    expect(stats[0].expectedTotal).toBe(30);
  });
});

describe("an archived medication", () => {
  it("is expected only for the days before it was archived", async () => {
    await seedDailyMed("m1");
    await seedDailyMed("m2", { isArchived: true, archivedAt: MID_WINDOW });

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    const active = stats.find((s) => s.medicationId === "m1")!;
    const archived = stats.find((s) => s.medicationId === "m2")!;
    expect(active.expectedTotal).toBe(30);
    // Archived at the midpoint: expected for those 15 days, not the full 30,
    // so stopping a medication is not scored as 30 days of missed doses.
    expect(archived.expectedTotal).toBe(15);
  });

  it("keeps contributing to daily adherence on days before the archive", async () => {
    await seedDailyMed("m1", { isArchived: true, archivedAt: MID_WINDOW });

    const series = await getDailyAdherenceSeries("u1", 30, "UTC", EXPLICIT_RANGE);

    const before = series.find((p) => p.date === "2026-07-25")!;
    const after = series.find((p) => p.date === "2026-08-15")!;
    // Archiving must not retroactively erase what was expected of you.
    expect(before.expected).toBeGreaterThan(0);
    expect(after.expected).toBe(0);
  });
});

describe("the two denominators", () => {
  it("agree on the total expected doses for the same window", async () => {
    await seedDailyMed("m1");

    const [breakdown, series] = await Promise.all([
      getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE),
      getDailyAdherenceSeries("u1", 30, "UTC", EXPLICIT_RANGE),
    ]);

    const seriesExpected = series.reduce((sum, p) => sum + p.expected, 0);
    expect(breakdown.expectedTotal).toBe(30);
    expect(Math.round(seriesExpected)).toBe(breakdown.expectedTotal);
  });

  it("agree that a PRN medication expects nothing, legacy interval or not", async () => {
    // No schedule rows, so both fall back to the legacy column — where one
    // gated on scheduleType and the other did not, inventing 4 doses a day
    // for a medication taken as needed.
    await pgDb.seedMedication({
      id: "m1",
      name: "PRN with a legacy interval",
      scheduleType: "as_needed",
      scheduleIntervalHours: "6",
      startedAt: LONG_AGO,
    });

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.expectedTotal).toBe(0);
    expect(breakdown.missedEvents).toBe(0);
  });
});

describe("lifecycle clamping still holds", () => {
  it("does not expect doses from before a medication was added", async () => {
    // Added at the window midpoint: 15 days of the 30-day window.
    await seedDailyMed("m1", { startedAt: MID_WINDOW });

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    expect(stats[0].expectedTotal).toBe(15);
  });

  it("ignores a medication whose whole lifecycle predates the window", async () => {
    await seedDailyMed("m1", {
      startedAt: LONG_AGO,
      endedAt: new Date("2026-02-01T00:00:00Z"),
    });

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    // Present or absent is a judgement call, but it must never claim
    // expected doses for a window it did not overlap.
    expect(stats.every((s) => s.expectedTotal === 0)).toBe(true);
  });
});
