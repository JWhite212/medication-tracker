import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DashboardPageData, RefillForecastEntry } from "$lib/types";

// The page load is I/O only now. `loadDashboard` owns the window, the four
// dashboard queries and the composition; `getRefillForecast` owns refills; the
// load merges the two. Everything it used to compute itself is gone: the
// per-medication `timingStatus`, the `covered` merge, and the raw `doses` and
// `scheduleSlots`. The database is `unusedDb`, so any query the load still
// makes on its own fails by name.

const DASH: Omit<DashboardPageData, "refillForecast"> = {
  now: "2026-04-16T08:30:00.000Z",
  nextRefreshAt: "2026-04-16T09:00:00.000Z",
  timezone: "Europe/London",
  todayStart: "2026-04-15T23:00:00.000Z",
  status: {
    kind: "none-today",
    dueCount: 0,
    doneToday: 0,
    totalToday: 0,
    loggedToday: 0,
    next: null,
  },
  earlier: [],
  today: [],
  done: [],
  later: [],
  medications: [],
};

const FORECAST: RefillForecastEntry[] = [
  {
    medicationId: "m1",
    medicationName: "Metformin",
    colour: "#6366f1",
    inventoryCount: 2,
    dailyRate: 1,
    daysUntilRefill: 2,
    severity: "critical",
  },
];

const loadDashboard = vi.fn(async (..._args: unknown[]) => DASH);
const getRefillForecast = vi.fn(async (..._args: unknown[]) => FORECAST);

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("@vercel/analytics/server", () => ({ track: async () => {} }));
vi.mock("$lib/server/dashboard/load", () => ({
  loadDashboard: (...args: unknown[]) => loadDashboard(...args),
}));
vi.mock("$lib/server/inventory", () => ({
  getRefillForecast: (...args: unknown[]) => getRefillForecast(...args),
}));

const { load } = await import("../../src/routes/(app)/dashboard/+page.server");

const locals = { user: { id: "u1", timezone: "Europe/London" }, session: { id: "s1" } };

async function runLoad(): Promise<Record<string, unknown>> {
  return (await load({ locals } as never)) as Record<string, unknown>;
}

beforeEach(() => {
  loadDashboard.mockClear();
  getRefillForecast.mockClear();
});

describe("dashboard page load", () => {
  it("returns loadDashboard's payload with the refill forecast merged in", async () => {
    expect(await runLoad()).toEqual({ ...DASH, refillForecast: FORECAST });
  });

  it("asks for the signed-in user's dashboard in their profile timezone, at one instant", async () => {
    const before = Date.now();
    await runLoad();
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    const [userId, timezone, now] = loadDashboard.mock.calls[0];
    expect(userId).toBe("u1");
    expect(timezone).toBe("Europe/London");
    expect(now).toBeInstanceOf(Date);
    expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(getRefillForecast).toHaveBeenCalledWith("u1");
  });

  it("no longer ships the per-medication timing model or the day's raw doses", async () => {
    const data = await runLoad();
    for (const gone of ["timingStatus", "scheduleSlots", "doses"]) {
      expect(data).not.toHaveProperty(gone);
    }
  });
});
