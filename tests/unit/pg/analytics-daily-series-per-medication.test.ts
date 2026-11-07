// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getDailyAdherenceSeries } = await import("../../../src/lib/server/analytics");

/**
 * The daily adherence series aggregates PER MEDICATION, exactly as
 * `foldDoseStatusBreakdown` does for the status breakdown: each medication's
 * taken doses are credited only up to what that medication expected that day,
 * and a medication expecting nothing contributes 0 to every term.
 *
 * It used to pool the day's taken doses across every medication, PRN
 * included, and divide by a denominator that excludes PRN, so the numerator
 * and the denominator ranged over different medication sets. A missed
 * once-daily dose beside one paracetamol read 100%, and so did one
 * medication taken twice beside another not taken at all.
 *
 * Also here: which day a preset series ends on. The span used to be
 * `Math.round((now - firstMidnight) / 86_400_000)`, which is `days` plus the
 * fraction of today already elapsed, so today's bar was missing before local
 * noon and reappeared after it.
 *
 * On PGlite because the per-medication counts are SQL grouping
 * (`date(taken_at AT TIME ZONE <tz>)`, `medication_id`), which a fake that
 * never evaluates SQL cannot exercise.
 */

const NOW = new Date("2026-08-21T12:00:00Z");
const LONG_AGO = new Date("2026-01-01T00:00:00Z");
const RANGE = {
  from: new Date("2026-08-18T00:00:00Z"),
  to: new Date("2026-08-21T00:00:00Z"),
};
const DAY = "2026-08-19";

beforeAll(() => {
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  vi.setSystemTime(NOW);
  await pgDb.reset();
  await pgDb.seedUser();
});

async function seedDailyMed(id: string) {
  await pgDb.seedMedication({
    id,
    name: `Med ${id}`,
    scheduleType: "scheduled",
    startedAt: LONG_AGO,
  });
  await pgDb.seedSchedule({ medicationId: id, scheduleKind: "fixed_time", timeOfDay: "08:00" });
}

async function pointOn(date: string) {
  const series = await getDailyAdherenceSeries("u1", 3, "UTC", RANGE);
  const point = series.find((p) => p.date === date);
  expect(point).toBeDefined();
  return point!;
}

describe("getDailyAdherenceSeries aggregates per medication", () => {
  it("a missed scheduled dose is not paid for by an as-needed dose", async () => {
    await seedDailyMed("sched");
    await pgDb.seedMedication({
      id: "prn",
      name: "Paracetamol",
      scheduleType: "as_needed",
      startedAt: LONG_AGO,
    });
    await pgDb.seedSchedule({ medicationId: "prn", scheduleKind: "prn", timeOfDay: null });
    await pgDb.seedDose({ medicationId: "prn", takenAt: new Date(`${DAY}T10:00:00Z`) });

    const point = await pointOn(DAY);

    expect(point.expected).toBe(1);
    expect(point.adherence).toBe(0);
    // The factual count still includes the PRN dose: the dose-volume
    // sparkline reads it.
    expect(point.doseCount).toBe(1);
  });

  it("one scheduled medication's surplus does not settle another's missed dose", async () => {
    await seedDailyMed("a");
    await seedDailyMed("b");
    await pgDb.seedDose({ medicationId: "a", takenAt: new Date(`${DAY}T08:00:00Z`) });
    await pgDb.seedDose({ medicationId: "a", takenAt: new Date(`${DAY}T09:00:00Z`) });

    const point = await pointOn(DAY);

    expect(point.expected).toBe(2);
    expect(point.adherence).toBe(50);
    expect(point.doseCount).toBe(2);
  });

  it("a dose of a medication before it started earns no credit", async () => {
    await seedDailyMed("a");
    // Starts the day after DAY, so it expects nothing on DAY; its dose then
    // must not fill a's miss.
    await pgDb.seedMedication({
      id: "late",
      name: "Late starter",
      scheduleType: "scheduled",
      startedAt: new Date("2026-08-20T00:00:00Z"),
    });
    await pgDb.seedSchedule({
      medicationId: "late",
      scheduleKind: "fixed_time",
      timeOfDay: "08:00",
    });
    await pgDb.seedDose({ medicationId: "late", takenAt: new Date(`${DAY}T08:00:00Z`) });

    const point = await pointOn(DAY);

    expect(point.expected).toBe(1);
    expect(point.adherence).toBe(0);
  });

  it("still reads 100% when every medication took its own doses", async () => {
    await seedDailyMed("a");
    await seedDailyMed("b");
    await pgDb.seedDose({ medicationId: "a", takenAt: new Date(`${DAY}T08:00:00Z`) });
    await pgDb.seedDose({ medicationId: "b", takenAt: new Date(`${DAY}T08:30:00Z`) });

    const point = await pointOn(DAY);

    expect(point.expected).toBe(2);
    expect(point.adherence).toBe(100);
  });
});

describe("a preset series always ends on today", () => {
  it.each([
    // Europe/London in summer is UTC+1: 08:00Z is 09:00 local, before noon.
    ["before local noon", "2026-06-15T08:00:00Z"],
    ["after local noon", "2026-06-15T14:00:00Z"],
  ])("%s", async (_label, nowIso) => {
    vi.setSystemTime(new Date(nowIso));
    await seedDailyMed("a");

    const dates = (await getDailyAdherenceSeries("u1", 14, "Europe/London")).map((p) => p.date);

    expect(dates[0]).toBe("2026-06-01");
    expect(dates.at(-1)).toBe("2026-06-15");
    expect(dates).toHaveLength(15);
  });

  it("an explicit range keeps exactly its own days", async () => {
    await seedDailyMed("a");

    const dates = (await getDailyAdherenceSeries("u1", 3, "UTC", RANGE)).map((p) => p.date);

    expect(dates).toEqual(["2026-08-18", "2026-08-19", "2026-08-20"]);
  });
});
