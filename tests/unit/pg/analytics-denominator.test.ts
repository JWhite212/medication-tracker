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

/**
 * The status breakdown aggregates PER MEDICATION.
 *
 * It used to pool every medication into scalars first and do the arithmetic
 * once at the bottom, which let one medication's events settle another's
 * debt. `expectedTotal` deliberately excludes a PRN medication while
 * `takenEvents` deliberately includes it, so the pooled numerator and the
 * pooled denominator ranged over different medication sets and the
 * subtraction was meaningless.
 *
 * Every fixture below uses EXPLICIT_RANGE — exactly 30.000 days — so the
 * effective-days clamp can never be the variable in an aggregation test.
 */
describe("the status breakdown aggregates per medication", () => {
  /** A pure-PRN medication: expects nothing, but its doses are still logged. */
  async function seedPrnMed(id: string, overrides = {}) {
    await pgDb.seedMedication({
      id,
      name: `PRN ${id}`,
      scheduleType: "as_needed",
      startedAt: LONG_AGO,
      ...overrides,
    });
    await pgDb.seedSchedule({ medicationId: id, scheduleKind: "prn", timeOfDay: null });
  }

  /**
   * `count` doses, all inside EXPLICIT_RANGE (22 Jul – 21 Aug).
   *
   * Spread across 25 days and stacked by hour rather than laid out on
   * consecutive days: an over-consumption fixture needs more doses than the
   * window has days, and running off the end would silently drop the surplus
   * that the test exists to observe.
   */
  async function seedDoses(
    medicationId: string,
    count: number,
    status: "taken" | "skipped" = "taken",
  ) {
    for (let i = 0; i < count; i++) {
      await pgDb.seedDose({
        medicationId,
        takenAt: new Date(Date.UTC(2026, 6, 23 + (i % 25), 6 + Math.floor(i / 25), 0, 0)),
        status,
      });
    }
  }

  it("does not let a PRN medication's doses erase another medication's misses", async () => {
    await seedDailyMed("sched");
    await seedDoses("sched", 20);
    await seedPrnMed("prn");
    await seedDoses("prn", 15);

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.expectedTotal).toBe(30);
    expect(breakdown.missedEvents).toBe(10);
    expect(breakdown.adherencePercent).toBe(66.7);
    expect(breakdown.overusePercent).toBe(0);
    // Load-bearing: forbids "fix it by filtering the PRN medication out of
    // the input set". Those fifteen doses were really taken and the
    // clinician PDF prints this number as "Taken events".
    expect(breakdown.takenEvents).toBe(35);
  });

  it("does the same when the PRN medication has no schedule rows at all", async () => {
    // Pre-backfill shape: the legacy `scheduleType` column is the only
    // signal. A fix keyed on `scheduleKind` would pass the test above and
    // leave every un-backfilled and JSON-imported account broken.
    await seedDailyMed("sched");
    await seedDoses("sched", 20);
    await pgDb.seedMedication({
      id: "prn",
      name: "Legacy PRN",
      scheduleType: "as_needed",
      startedAt: LONG_AGO,
    });
    await seedDoses("prn", 15);

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.expectedTotal).toBe(30);
    expect(breakdown.missedEvents).toBe(10);
    expect(breakdown.adherencePercent).toBe(66.7);
    expect(breakdown.overusePercent).toBe(0);
  });

  it("does not let a PRN medication's SKIPPED doses erase another's misses", async () => {
    // `resolved` pooled taken AND skipped, so skipping a PRN medication
    // fifteen times settled a scheduled medication's debt just as taking it
    // did. Reachable from the app, `/api/v1 skip_dose` and import.
    await seedDailyMed("sched");
    await seedDoses("sched", 20);
    await seedPrnMed("prn");
    await seedDoses("prn", 15, "skipped");

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.skippedEvents).toBe(15);
    expect(breakdown.missedEvents).toBe(10);
  });

  it("does not let one scheduled medication's overuse erase another's misses", async () => {
    // No PRN anywhere. This is what proves the fix is not a PRN patch: the
    // defect is the pooling, and two ordinary scheduled medications reach it.
    await seedDailyMed("under");
    await seedDoses("under", 5);
    await seedDailyMed("over");
    await seedDoses("over", 55);

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.expectedTotal).toBe(60);
    expect(breakdown.takenEvents).toBe(60);
    // 25 of `under`'s doses were genuinely missed. Pooling reported none,
    // because `over` had taken 25 more than it was expected to.
    expect(breakdown.missedEvents).toBe(25);
    // Credited per medication: min(5,30) + min(55,30) = 35 of 60.
    expect(breakdown.adherencePercent).toBe(58.3);
    // And the surplus is visible rather than absorbed: 25 of 60.
    expect(breakdown.overusePercent).toBe(41.7);
  });

  it("still reports a single medication's genuine overuse", async () => {
    // The trap on the other side: capping the numerator for adherence and
    // reusing that capped value for overuse makes overuse permanently 0,
    // and `export-pdf.ts`'s `> 0` gate then deletes the line entirely.
    await seedDailyMed("m1");
    await seedDoses("m1", 45);

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.expectedTotal).toBe(30);
    expect(breakdown.missedEvents).toBe(0);
    expect(breakdown.adherencePercent).toBe(100);
    expect(breakdown.overusePercent).toBe(50);
  });

  it("lets a medication that expects nothing perturb no ratio at all", async () => {
    await seedPrnMed("prn");
    await seedDoses("prn", 15);

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", EXPLICIT_RANGE);

    expect(breakdown.takenEvents).toBe(15);
    expect(breakdown.expectedTotal).toBe(0);
    expect(breakdown.missedEvents).toBe(0);
    // Both ratios keep `calculateAdherence`/`calculateOveruse`'s existing
    // "expected === 0 → 0" contract; nothing here changes it.
    expect(breakdown.adherencePercent).toBe(0);
    expect(breakdown.overusePercent).toBe(0);
  });
});

/**
 * The effective-days clamp.
 *
 * `clampEffectiveDays` rounded a millisecond duration half-up, so a
 * medication whose window is clipped mid-day was charged a whole extra
 * expected dose from twelve hours into the partial day — the skew arrived
 * at local noon, with no user action, and rendered as a red Missed segment
 * and a clinician-facing missed count.
 *
 * These fixtures deliberately do NOT use EXPLICIT_RANGE: a fractional span
 * is the whole point, and every span the shipping tests above pin is a
 * whole number of days, which is why 1825 green tests said nothing here.
 */
describe("the effective-days clamp", () => {
  it("does not charge a whole day for a half-elapsed one", async () => {
    // Default window: [NOW-30d, NOW] = [2026-07-22T12:00Z, 2026-08-21T12:00Z].
    // Started at midnight on 6 August, so the clipped span is 15 days and
    // 12 hours. Fifteen 20:00 slots have come due and all fifteen were taken.
    await pgDb.seedMedication({
      id: "m1",
      name: "Evening med",
      scheduleType: "scheduled",
      startedAt: new Date("2026-08-06T00:00:00Z"),
    });
    await pgDb.seedSchedule({ medicationId: "m1", scheduleKind: "fixed_time", timeOfDay: "20:00" });
    for (let i = 0; i < 15; i++) {
      await pgDb.seedDose({
        medicationId: "m1",
        takenAt: new Date(Date.UTC(2026, 7, 6 + i, 20, 0, 0)),
      });
    }

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC");

    expect(breakdown.takenEvents).toBe(15);
    expect(breakdown.expectedTotal).toBe(15);
    expect(breakdown.missedEvents).toBe(0);
    expect(breakdown.adherencePercent).toBe(100);
  });

  it("counts a range bounded at its last included millisecond as whole days", async () => {
    // The clinician PDF's exact call shape: `to` is the exclusive start of
    // the next day, and `export-pdf.ts` hands the breakdown `to - 1ms` so
    // the summary counts the same rows the table beneath it lists. That
    // makes the span 29.999999988 days, and nothing in the repo pinned it.
    await seedDailyMed("m1");

    const breakdown = await getDoseStatusBreakdown("u1", 30, "UTC", {
      from: EXPLICIT_RANGE.from,
      to: new Date(EXPLICIT_RANGE.to.getTime() - 1),
    });

    expect(breakdown.expectedTotal).toBe(30);
  });

  it("expects nothing yet from a medication added six hours ago", async () => {
    // The opposite error: rounding a partial day UP invents an expectation
    // that has not elapsed, and a fabricated one is rendered as a missed
    // dose and can reach `buildInsights`'s "Lowest adherence" ranking.
    await pgDb.seedMedication({
      id: "m1",
      name: "Just added",
      scheduleType: "scheduled",
      startedAt: new Date(NOW.getTime() - 6 * 60 * 60 * 1000),
    });
    for (const timeOfDay of ["08:00", "14:00", "20:00"]) {
      await pgDb.seedSchedule({ medicationId: "m1", scheduleKind: "fixed_time", timeOfDay });
    }

    const stats = await getPerMedicationStats("u1", 30, "UTC");

    expect(stats[0].expectedTotal).toBe(0);
  });
});
