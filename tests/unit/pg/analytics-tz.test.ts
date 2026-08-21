// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getDailyDoseCounts, getHourlyDistribution, getDayOfWeekDistribution } =
  await import("../../../src/lib/server/analytics");

/** `date(...)` comes back from the driver as a Date, while the query types it
    as a string. Normalise to a YYYY-MM-DD local-date string either way, so
    the assertions below say what they mean. */
function isoDay(value: unknown): string {
  if (value instanceof Date) {
    // The value is a bare Postgres `date`; read it in UTC so no second
    // timezone conversion is applied on top of the one under test.
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

beforeAll(() => {
  // Date only — faking all timers stalls PGlite. Mid-June, so British
  // Summer Time (UTC+1) is in effect and the window covers the fixtures.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication();
});

describe("daily grouping across a BST offset", () => {
  it("counts a late-evening UTC dose as the NEXT local day in London", async () => {
    // 23:30 UTC on 1 June is 00:30 on 2 June in BST.
    await pgDb.seedDose({ takenAt: new Date("2026-06-01T23:30:00Z") });

    const rows = await getDailyDoseCounts("u1", 30, "Europe/London");

    expect(rows).toHaveLength(1);
    expect(isoDay(rows[0].date)).toBe("2026-06-02");
    expect(rows[0].count).toBe(1);
  });

  it("counts the same instant as 1 June under UTC", async () => {
    await pgDb.seedDose({ takenAt: new Date("2026-06-01T23:30:00Z") });

    const rows = await getDailyDoseCounts("u1", 30, "UTC");

    // Same row, same query, different timezone — the only thing that can
    // move it is the AT TIME ZONE conversion.
    expect(isoDay(rows[0].date)).toBe("2026-06-01");
  });

  it("keeps two doses either side of local midnight on separate days", async () => {
    await pgDb.seedDose({ id: "before", takenAt: new Date("2026-06-01T22:00:00Z") }); // 23:00 BST, 1 June
    await pgDb.seedDose({ id: "after", takenAt: new Date("2026-06-01T23:30:00Z") }); // 00:30 BST, 2 June

    const rows = await getDailyDoseCounts("u1", 30, "Europe/London");

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
    expect(rows.map((r) => isoDay(r.date)).sort()).toEqual(["2026-06-01", "2026-06-02"]);
  });
});

describe("hour and day-of-week extraction", () => {
  it("reports the LOCAL hour, not the UTC hour", async () => {
    await pgDb.seedDose({ takenAt: new Date("2026-06-10T08:15:00Z") }); // 09:15 BST

    const rows = await getHourlyDistribution("u1", 30, "Europe/London");

    expect(rows).toHaveLength(1);
    expect(rows[0].hour).toBe(9);
  });

  it("reports the LOCAL day of week when the offset rolls the date over", async () => {
    // 23:30 UTC Monday 1 June is 00:30 Tuesday 2 June in BST.
    await pgDb.seedDose({ takenAt: new Date("2026-06-01T23:30:00Z") });

    const rows = await getDayOfWeekDistribution("u1", 30, "Europe/London");

    // Postgres extract(dow): Sunday = 0, so Tuesday = 2.
    expect(rows[0].dayOfWeek).toBe(2);
  });
});
