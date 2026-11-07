import { describe, expect, it, vi } from "vitest";

// composeAnalyticsPageData is pure; unusedDb throws if anything reaches the db.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import {
  composeAnalyticsPageData,
  type AnalyticsCompositionInputs,
} from "$lib/server/analytics/page-data";

type Stat = AnalyticsCompositionInputs["medStats"][number];

function stat(id: string, adherence: number, expectedTotal: number): Stat {
  return {
    medicationId: id,
    medicationName: id,
    adherence,
    expectedTotal,
  } as unknown as Stat;
}

function compose(medStats: Stat[], prevMedStats: Stat[]) {
  return composeAnalyticsPageData({
    timezone: "Europe/London",
    period: 30,
    fromParam: null,
    toParam: null,
    medicationIds: undefined,
    medicationOptions: [],
    dailyCounts: [],
    medStats,
    hourly: [],
    dayOfWeek: [],
    sideEffects: { frequency: [] },
    dailyAdherence: [],
    statusBreakdown: {},
    scheduleVariance: [],
    schedulesByMed: new Map(),
    prevDailyCounts: [],
    prevMedStats,
    refillForecast: [],
  } as unknown as AnalyticsCompositionInputs);
}

describe("headline average adherence", () => {
  it("ignores a medication that expected nothing in the window", () => {
    // A: taken perfectly. B: archived long ago / added today, so it expected
    // nothing and calculateAdherence(x, 0) scored it 0.
    const page = compose(
      [stat("a", 100, 30), stat("b", 0, 0)],
      [stat("a", 100, 30), stat("b", 0, 0)],
    );
    expect(page.avgAdherence).toBe(100);
  });

  it("does not manufacture a trend from a medication that expected nothing last window", () => {
    // B started during the current window: nothing was expected of it in the
    // previous one. Both windows are really 100%.
    const page = compose(
      [stat("a", 100, 30), stat("b", 100, 10)],
      [stat("a", 100, 30), stat("b", 0, 0)],
    );
    expect(page.avgAdherence).toBe(100);
    expect(page.trends.adherence).toEqual(
      compose([stat("a", 100, 30)], [stat("a", 100, 30)]).trends.adherence,
    );
  });

  it("still lets a medication that expected doses drag the average down", () => {
    const page = compose([stat("a", 100, 30), stat("b", 0, 30)], []);
    expect(page.avgAdherence).toBe(50);
  });
});
