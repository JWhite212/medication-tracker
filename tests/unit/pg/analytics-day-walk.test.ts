// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getDailyAdherenceSeries } = await import("../../../src/lib/server/analytics");

/**
 * The daily adherence series emits one point per civil day. It used to walk
 * them by stepping a fixed 86,400,000 ms from a local midnight, which drifts
 * across a DST transition because a civil day is 23, 24, 24.5 or 25 hours
 * long: after an autumn fall-back the transition day was emitted TWICE and
 * the day at the far end was never emitted at all.
 *
 * On PGlite rather than `fake-db` because the series is half SQL — the counts
 * come from `date(taken_at AT TIME ZONE <tz>)`, and the property that matters
 * is that the JS day keys and the SQL grouping keys agree. A fixture handing
 * back canned rows cannot disagree with itself.
 *
 * NOT asserted here: which day the series ENDS on. That is decided by `span`
 * (`Math.round((to - from) / 86_400_000)`), so the series covers 14 points
 * before local noon and 15 after — a real defect, but a different one, owned
 * by the analytics-window work. Pinning it here would make this file fail for
 * a reason that has nothing to do with the walk.
 */

beforeAll(() => {
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({ scheduleType: "scheduled", scheduleIntervalHours: "24" });
});

/** Every key exactly one calendar day after the last, with none repeated. */
function expectConsecutiveDistinctDays(dates: string[]) {
  expect(new Set(dates).size).toBe(dates.length);
  for (let i = 1; i < dates.length; i++) {
    const previous = new Date(`${dates[i - 1]}T00:00:00Z`).getTime();
    const current = new Date(`${dates[i]}T00:00:00Z`).getTime();
    expect({
      from: dates[i - 1],
      to: dates[i],
      gapDays: (current - previous) / 86_400_000,
    }).toEqual({ from: dates[i - 1], to: dates[i], gapDays: 1 });
  }
}

describe("getDailyAdherenceSeries — walking day keys across a DST transition", () => {
  it.each([
    // Each `now` sits a few days after that zone's autumn fall-back, the
    // direction in which the fixed step duplicated a day and lost one.
    ["America/New_York", "2026-11-04T15:00:00Z", "2026-11-01"],
    ["Europe/London", "2026-10-28T09:00:00Z", "2026-10-25"],
    ["Pacific/Auckland", "2026-04-10T02:00:00Z", "2026-04-05"],
  ])("%s emits %s once, and every day between", async (timezone, nowIso, transitionDay) => {
    vi.setSystemTime(new Date(nowIso));

    const dates = (await getDailyAdherenceSeries("u1", 14, timezone)).map((point) => point.date);

    expect(dates).toContain(transitionDay);
    expect(dates.filter((day) => day === transitionDay)).toHaveLength(1);
    expectConsecutiveDistinctDays(dates);
  });

  it.each([
    ["America/New_York", "2026-03-11T15:00:00Z", "2026-03-08"],
    ["Europe/London", "2026-04-01T09:00:00Z", "2026-03-29"],
  ])("%s handles the spring-forward direction too", async (timezone, nowIso, transitionDay) => {
    vi.setSystemTime(new Date(nowIso));

    const dates = (await getDailyAdherenceSeries("u1", 14, timezone)).map((point) => point.date);

    expect(dates.filter((day) => day === transitionDay)).toHaveLength(1);
    expectConsecutiveDistinctDays(dates);
  });

  it("a dose on the transition day is counted on that day, not on its twin", async () => {
    // The JS key walk and the SQL `AT TIME ZONE` grouping must agree, or the
    // count lands on a key the series never renders and the dose disappears.
    vi.setSystemTime(new Date("2026-11-04T15:00:00Z"));
    // 23:00Z on 1 November is 18:00 in New York — the same civil day either
    // side of that morning's 06:00Z fall-back.
    await pgDb.seedDose({ takenAt: new Date("2026-11-01T23:00:00Z") });

    const series = await getDailyAdherenceSeries("u1", 14, "America/New_York");
    const transitionDay = series.filter((point) => point.date === "2026-11-01");

    expect(transitionDay).toHaveLength(1);
    expect(transitionDay[0].doseCount).toBe(1);
    expect(series.reduce((sum, point) => sum + point.doseCount, 0)).toBe(1);
  });

  it("an ordinary fortnight is unaffected — the control", async () => {
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    const dates = (await getDailyAdherenceSeries("u1", 14, "Europe/London")).map((p) => p.date);

    expectConsecutiveDistinctDays(dates);
    expect(dates[0]).toBe("2026-06-01");
  });
});
