import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AnalyticsFilter, InsightInputs } from "$lib/server/analytics";

/**
 * Characterization harness for the analytics page load.
 *
 * Everything between the awaits and the `return` in
 * `src/routes/(app)/analytics/+page.server.ts` is pure composition:
 * query-param resolution, the previous-period window, scheduledHours
 * extraction, the dose/adherence aggregates, and the buildInsights and
 * trends assembly. None of it had a test at any depth.
 *
 * These tests deliberately drive `load` rather than any extracted
 * helper, so they keep passing byte-identical when the composition
 * moves into its own module. A test written against the new module
 * could not exist before the move, and so could not witness it.
 */

// The load reads Date.now() for the default previous-period window, and
// dateParamSchema's upper bound is evaluated when the module is first
// imported — so the clock must be frozen before the dynamic import below.
const NOW = new Date("2026-08-21T12:00:00Z");
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(NOW);

const DAY_MS = 86_400_000;

type MedOption = { id: string; name: string; colour: string; isArchived: boolean };
type Schedule = { medicationId: string; scheduleKind: string; timeOfDay: string | null };
type MedStat = {
  medicationId: string;
  medicationName: string;
  adherence: number;
  expectedTotal: number;
};
type Refill = { medicationId: string; severity: string };

const data = {
  medicationOptions: [] as MedOption[],
  dailyCounts: [] as { date: string; count: number }[],
  prevDailyCounts: [] as { date: string; count: number }[],
  medStats: [] as MedStat[],
  prevMedStats: [] as MedStat[],
  hourly: [] as { hour: number; count: number }[],
  dayOfWeek: [] as { dayOfWeek: number; count: number }[],
  sideEffects: { frequency: [] as { name: string; count: number }[] },
  schedulesByMed: new Map<string, Schedule[]>(),
  refills: [] as Refill[],
};

type QueryCall = { userId: string; days: number; timezone: string; filter?: AnalyticsFilter };
const dailyCountsCalls: QueryCall[] = [];
const medStatsCalls: QueryCall[] = [];
const hourlyCalls: QueryCall[] = [];
const insightInputs: InsightInputs[] = [];

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

vi.mock("$lib/server/medications", () => ({
  getMedicationOptions: async () => data.medicationOptions,
}));

vi.mock("$lib/server/inventory", () => ({
  getRefillForecast: async () => data.refills,
}));

vi.mock("$lib/server/schedules", () => ({
  getSchedulesForUser: async () => data.schedulesByMed,
}));

// The eight query functions are replaced; the four pure ones
// (buildInsights, calculateStreak, calculateTrend, resolveMedicationFilter)
// keep their real implementations so the composition is measured against
// real arithmetic, with buildInsights' argument captured for assertions.
vi.mock("$lib/server/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("$lib/server/analytics")>();
  return {
    ...actual,
    // Call 1 is the current window, call 2 the previous one: the load
    // builds both inside a single Promise.all array literal, whose call
    // expressions evaluate in source order.
    getDailyDoseCounts: async (
      userId: string,
      days: number,
      timezone: string,
      filter?: AnalyticsFilter,
    ) => {
      dailyCountsCalls.push({ userId, days, timezone, filter });
      return dailyCountsCalls.length === 1 ? data.dailyCounts : data.prevDailyCounts;
    },
    getPerMedicationStats: async (
      userId: string,
      days: number,
      timezone: string,
      filter?: AnalyticsFilter,
    ) => {
      medStatsCalls.push({ userId, days, timezone, filter });
      return medStatsCalls.length === 1 ? data.medStats : data.prevMedStats;
    },
    getHourlyDistribution: async (
      userId: string,
      days: number,
      timezone: string,
      filter?: AnalyticsFilter,
    ) => {
      hourlyCalls.push({ userId, days, timezone, filter });
      return data.hourly;
    },
    getDayOfWeekDistribution: async () => data.dayOfWeek,
    getSideEffectStats: async () => data.sideEffects,
    getDailyAdherenceSeries: async () => [],
    getDoseStatusBreakdown: async () => ({}),
    getScheduleVariance: async () => [],
    buildInsights: (input: InsightInputs) => {
      insightInputs.push(input);
      return actual.buildInsights(input);
    },
  };
});

const { load } = await import("../../src/routes/(app)/analytics/+page.server");

type Trend = { direction: string; percent: number };
type LoadData = {
  scheduledHours: number[];
  streak: number;
  period: number;
  totalDoses: number;
  avgAdherence: number;
  trends: {
    doses: Trend;
    adherence: Trend;
    perMedication: { medicationId: string; trend: Trend }[];
  };
  from: string;
  to: string;
  medications: MedOption[];
  selectedMedIds: string[];
};

async function runLoad(query = "", heatmapPeriod = 90): Promise<LoadData> {
  return (await load({
    locals: { user: { id: "u1", timezone: "UTC" } },
    parent: async () => ({ preferences: { heatmapPeriod } }),
    url: new URL(`http://localhost/analytics${query}`),
  } as never)) as LoadData;
}

beforeEach(() => {
  vi.setSystemTime(NOW);
  data.medicationOptions = [
    { id: "med-a", name: "A", colour: "#111111", isArchived: false },
    { id: "med-b", name: "B", colour: "#222222", isArchived: false },
  ];
  data.dailyCounts = [];
  data.prevDailyCounts = [];
  data.medStats = [];
  data.prevMedStats = [];
  data.hourly = [];
  data.dayOfWeek = [];
  data.sideEffects = { frequency: [] };
  data.schedulesByMed = new Map();
  data.refills = [];
  dailyCountsCalls.length = 0;
  medStatsCalls.length = 0;
  hourlyCalls.length = 0;
  insightInputs.length = 0;
});

describe("analytics load: period resolution", () => {
  it("uses the heatmapPeriod preference when no period param is given", async () => {
    const d = await runLoad("", 30);
    expect(d.period).toBe(30);
    expect(dailyCountsCalls[0].days).toBe(30);
  });

  it("honours a period param from the allowed set", async () => {
    const d = await runLoad("?period=7", 30);
    expect(d.period).toBe(7);
    expect(dailyCountsCalls[0].days).toBe(7);
  });

  it("falls back to the preference for a period outside the allowed set", async () => {
    const d = await runLoad("?period=45", 30);
    expect(d.period).toBe(30);
  });

  it("passes the resolved period to every windowed query", async () => {
    await runLoad("?period=365", 30);
    expect(medStatsCalls[0].days).toBe(365);
    expect(hourlyCalls[0].days).toBe(365);
  });
});

describe("analytics load: date range params", () => {
  it("applies a custom range to the queries and echoes the raw strings back", async () => {
    const d = await runLoad("?from=2026-08-01&to=2026-08-10");
    expect(dailyCountsCalls[0].filter?.from).toEqual(new Date("2026-08-01T00:00:00Z"));
    expect(dailyCountsCalls[0].filter?.to).toEqual(new Date("2026-08-10T00:00:00Z"));
    expect(d.from).toBe("2026-08-01");
    expect(d.to).toBe("2026-08-10");
  });

  it("echoes a lone valid `from` without applying it as a range", async () => {
    const d = await runLoad("?from=2026-08-01");
    expect(dailyCountsCalls[0].filter?.from).toBeUndefined();
    expect(d.from).toBe("2026-08-01");
    expect(d.to).toBe("");
  });

  it("drops an unparseable date rather than throwing", async () => {
    const d = await runLoad("?from=not-a-date&to=2026-08-10");
    expect(dailyCountsCalls[0].filter?.from).toBeUndefined();
    expect(d.from).toBe("");
    expect(d.to).toBe("2026-08-10");
  });

  it("rejects a date earlier than the 2020 floor", async () => {
    const d = await runLoad("?from=2019-12-31&to=2026-08-10");
    expect(d.from).toBe("");
    expect(dailyCountsCalls[0].filter?.from).toBeUndefined();
  });

  it("rejects a date beyond the future ceiling", async () => {
    const d = await runLoad("?from=2026-08-01&to=2027-01-01");
    expect(d.to).toBe("");
    expect(dailyCountsCalls[0].filter?.to).toBeUndefined();
  });
});

describe("analytics load: previous-period window", () => {
  it("derives the default previous window as the period immediately before this one", async () => {
    await runLoad("?period=30");
    const prev = dailyCountsCalls[1].filter;
    expect(prev?.from).toEqual(new Date(NOW.getTime() - 60 * DAY_MS));
    expect(prev?.to).toEqual(new Date(NOW.getTime() - 30 * DAY_MS));
  });

  it("mirrors a custom range backwards by its own span", async () => {
    await runLoad("?from=2026-08-01&to=2026-08-11");
    const prev = medStatsCalls[1].filter;
    expect(prev?.from).toEqual(new Date("2026-07-22T00:00:00Z"));
    expect(prev?.to).toEqual(new Date("2026-08-01T00:00:00Z"));
  });
});

describe("analytics load: medication filter", () => {
  it("passes an owned medication id to every query and echoes the selection", async () => {
    const d = await runLoad("?med=med-a");
    expect(dailyCountsCalls[0].filter?.medicationIds).toEqual(["med-a"]);
    expect(dailyCountsCalls[1].filter?.medicationIds).toEqual(["med-a"]);
    expect(hourlyCalls[0].filter?.medicationIds).toEqual(["med-a"]);
    expect(d.selectedMedIds).toEqual(["med-a"]);
  });

  it("treats an unowned medication id as no filter at all", async () => {
    const d = await runLoad("?med=med-someone-elses");
    expect(dailyCountsCalls[0].filter?.medicationIds).toBeUndefined();
    expect(d.selectedMedIds).toEqual([]);
  });

  it("returns the medication options for the filter control", async () => {
    const d = await runLoad();
    expect(d.medications.map((m) => m.id)).toEqual(["med-a", "med-b"]);
  });
});

describe("analytics load: scheduledHours", () => {
  it("collects the hour of every fixed-time slot, deduplicated and sorted", async () => {
    data.schedulesByMed = new Map([
      [
        "med-a",
        [
          { medicationId: "med-a", scheduleKind: "fixed_time", timeOfDay: "21:00" },
          { medicationId: "med-a", scheduleKind: "fixed_time", timeOfDay: "08:30" },
        ],
      ],
      ["med-b", [{ medicationId: "med-b", scheduleKind: "fixed_time", timeOfDay: "08:00" }]],
    ]);
    const d = await runLoad();
    expect(d.scheduledHours).toEqual([8, 21]);
  });

  // The interval row carries a timeOfDay on purpose. With it left null the
  // scheduleKind check is unfalsifiable — deleting the guard still yields
  // [9], because every non-fixed_time row is caught by the downstream
  // timeOfDay check instead. Only a row that passes that second gate can
  // witness the first one.
  it("ignores interval and prn rows, and fixed-time rows with no time", async () => {
    data.schedulesByMed = new Map([
      [
        "med-a",
        [
          { medicationId: "med-a", scheduleKind: "interval", timeOfDay: "03:00" },
          { medicationId: "med-a", scheduleKind: "prn", timeOfDay: "05:00" },
          { medicationId: "med-a", scheduleKind: "fixed_time", timeOfDay: null },
          { medicationId: "med-a", scheduleKind: "fixed_time", timeOfDay: "09:00" },
        ],
      ],
    ]);
    const d = await runLoad();
    expect(d.scheduledHours).toEqual([9]);
  });

  it("restricts the hours to the selected medications", async () => {
    data.schedulesByMed = new Map([
      ["med-a", [{ medicationId: "med-a", scheduleKind: "fixed_time", timeOfDay: "07:00" }]],
      ["med-b", [{ medicationId: "med-b", scheduleKind: "fixed_time", timeOfDay: "19:00" }]],
    ]);
    const d = await runLoad("?med=med-a");
    expect(d.scheduledHours).toEqual([7]);
  });
});

describe("analytics load: refill input to insights", () => {
  it("counts warning as well as critical refills", async () => {
    data.refills = [
      { medicationId: "med-a", severity: "critical" },
      { medicationId: "med-b", severity: "warning" },
    ];
    await runLoad();
    expect(insightInputs[0].refillCriticalCount).toBe(2);
  });

  it("ignores refills that are only on the watch list", async () => {
    data.refills = [
      { medicationId: "med-a", severity: "watch" },
      { medicationId: "med-b", severity: "critical" },
    ];
    await runLoad();
    expect(insightInputs[0].refillCriticalCount).toBe(1);
  });

  it("counts only the selected medications' refills", async () => {
    data.refills = [
      { medicationId: "med-a", severity: "critical" },
      { medicationId: "med-b", severity: "critical" },
    ];
    await runLoad("?med=med-a");
    expect(insightInputs[0].refillCriticalCount).toBe(1);
  });
});

describe("analytics load: aggregates", () => {
  it("sums the daily counts of both windows into the dose trend", async () => {
    data.dailyCounts = [
      { date: "2026-08-21", count: 7 },
      { date: "2026-08-20", count: 5 },
    ];
    data.prevDailyCounts = [{ date: "2026-07-21", count: 10 }];
    const d = await runLoad();
    expect(d.totalDoses).toBe(12);
    expect(insightInputs[0].prevTotalDoses).toBe(10);
    expect(d.trends.doses).toEqual({ direction: "up", percent: 20 });
  });

  it("averages adherence across medications, rounded to a whole percent", async () => {
    data.medStats = [
      { medicationId: "med-a", medicationName: "A", adherence: 90, expectedTotal: 30 },
      { medicationId: "med-b", medicationName: "B", adherence: 81, expectedTotal: 30 },
    ];
    data.prevMedStats = [
      { medicationId: "med-a", medicationName: "A", adherence: 80, expectedTotal: 30 },
    ];
    const d = await runLoad();
    expect(d.avgAdherence).toBe(86);
    expect(insightInputs[0].prevAvgAdherence).toBe(80);
    expect(d.trends.adherence).toEqual({ direction: "up", percent: 8 });
  });

  it("reports zero adherence rather than NaN when no medication has stats", async () => {
    const d = await runLoad();
    expect(d.avgAdherence).toBe(0);
    expect(d.totalDoses).toBe(0);
  });
});

describe("analytics load: per-medication trends", () => {
  it("pairs each medication with its own previous-window adherence", async () => {
    data.medStats = [
      { medicationId: "med-a", medicationName: "A", adherence: 90, expectedTotal: 30 },
    ];
    data.prevMedStats = [
      { medicationId: "med-b", medicationName: "B", adherence: 1, expectedTotal: 30 },
      { medicationId: "med-a", medicationName: "A", adherence: 60, expectedTotal: 30 },
    ];
    const d = await runLoad();
    expect(d.trends.perMedication).toEqual([
      { medicationId: "med-a", trend: { direction: "up", percent: 50 } },
    ]);
  });

  it("compares a medication absent from the previous window against zero", async () => {
    data.medStats = [
      { medicationId: "med-b", medicationName: "B", adherence: 81, expectedTotal: 30 },
    ];
    const d = await runLoad();
    expect(d.trends.perMedication).toEqual([
      { medicationId: "med-b", trend: { direction: "up", percent: 100 } },
    ]);
  });
});

describe("analytics load: insight inputs", () => {
  it("totals the side-effect frequencies and names the most common one", async () => {
    data.sideEffects = {
      frequency: [
        { name: "nausea", count: 4 },
        { name: "drowsiness", count: 2 },
      ],
    };
    await runLoad();
    expect(insightInputs[0].sideEffectsCount).toBe(6);
    expect(insightInputs[0].topSideEffect).toBe("nausea");
  });

  it("reports no top side effect when none were recorded", async () => {
    await runLoad();
    expect(insightInputs[0].sideEffectsCount).toBe(0);
    expect(insightInputs[0].topSideEffect).toBeNull();
  });

  it("derives the streak from the current window's dose dates", async () => {
    data.dailyCounts = [
      { date: "2026-08-21", count: 1 },
      { date: "2026-08-20", count: 1 },
      { date: "2026-08-19", count: 1 },
    ];
    const d = await runLoad();
    expect(d.streak).toBe(3);
    expect(insightInputs[0].streak).toBe(3);
  });
});
