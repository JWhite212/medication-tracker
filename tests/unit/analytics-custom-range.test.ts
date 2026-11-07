import { describe, it, expect, vi } from "vitest";

// composeAnalyticsPageData is pure; unusedDb throws if anything reaches the db.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import {
  composeAnalyticsPageData,
  resolveAnalyticsQuery,
  type AnalyticsCompositionInputs,
} from "$lib/server/analytics/page-data";
import { buildHeatmapDays } from "$lib/utils/heatmap";

/**
 * A custom From/To range replaced the preset period in every query, but the
 * payload carried only `period`, so the page kept labelling, heatmapping and
 * toggling the preset: January's numbers sat under "Doses (30 days)", with
 * the 30d Toggle pressed and a heatmap of the last 30 days ending today, all
 * of it 0 because no January key falls inside that span.
 */

function composeFor(search: string, defaultPeriod = 30) {
  const query = resolveAnalyticsQuery(new URLSearchParams(search), defaultPeriod);
  return composeAnalyticsPageData({
    timezone: "Europe/London",
    period: query.period,
    customRange: query.customRange,
    fromParam: query.fromParam,
    toParam: query.toParam,
    medicationIds: undefined,
    medicationOptions: [],
    dailyCounts: [],
    medStats: [],
    hourly: [],
    dayOfWeek: [],
    sideEffects: { frequency: [] },
    dailyAdherence: [],
    statusBreakdown: {},
    scheduleVariance: [],
    schedulesByMed: new Map(),
    prevDailyCounts: [],
    prevMedStats: [],
    refillForecast: [],
  } as unknown as AnalyticsCompositionInputs);
}

describe("the analytics payload under a custom range", () => {
  it("names the picked days and counts both ends", () => {
    const page = composeFor("from=2026-01-01&to=2026-01-31");
    expect(page.range).toEqual({ fromKey: "2026-01-01", toKey: "2026-01-31", days: 31 });
    // period is untouched: the queries and the preset path still read it.
    expect(page.period).toBe(30);
  });

  it("counts a one-day range as one day", () => {
    expect(composeFor("from=2026-03-29&to=2026-03-29").range).toEqual({
      fromKey: "2026-03-29",
      toKey: "2026-03-29",
      days: 1,
    });
  });

  it("is null under a preset, or when the range does not apply", () => {
    for (const search of [
      "",
      "period=7",
      "from=2026-01-01", // one bound is not a range
      "to=2026-01-31",
      "from=2026-02-01&to=2026-01-01", // inverted: echoed, not applied
      "from=nonsense&to=2026-01-31",
    ]) {
      expect(composeFor(search).range, search).toBeNull();
    }
  });
});

describe("buildHeatmapDays with an end key", () => {
  it("ends on the key instead of today, in any zone", () => {
    const now = new Date("2026-11-06T10:00:00Z");
    for (const tz of ["UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
      const days = buildHeatmapDays(31, tz, now, "2026-01-31");
      expect(days, tz).toHaveLength(31);
      expect(days[0].date, tz).toBe("2026-01-01");
      expect(days.at(-1)!.date, tz).toBe("2026-01-31");
    }
  });

  it("walks whole civil days across a DST transition", () => {
    // Europe/London springs forward on 2026-03-29.
    const days = buildHeatmapDays(3, "Europe/London", new Date(), "2026-03-30");
    expect(days.map((d) => d.date)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    // 2026-03-28 is a Saturday.
    expect(days.map((d) => d.row)).toEqual([6, 0, 1]);
  });

  it("keeps ending today when no key is given", () => {
    const now = new Date("2026-04-15T10:00:00Z");
    expect(buildHeatmapDays(2, "UTC", now).map((d) => d.date)).toEqual([
      "2026-04-14",
      "2026-04-15",
    ]);
  });
});
