// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { load } = await import("../../../src/routes/(app)/medications/+page.server");

/**
 * The Medications list sparkline: 14 consecutive civil days ending today.
 *
 * On PGlite because the bars are a join between JS day keys and SQL
 * `date(taken_at AT TIME ZONE <tz>)` — the failure mode is the two disagreeing,
 * which a fixture handing back canned rows cannot reproduce.
 *
 * Both halves are load-bearing and both were wrong at different times. The
 * WALK (stepping a fixed 86,400,000 ms) emitted the transition day twice and
 * dropped the far end. The ANCHOR (subtracting 13 x 86,400,000 from an instant
 * before taking its local midnight) landed a day early inside a one-hour band
 * — and once the walk became exact, that error stopped being absorbed by the
 * duplicate and pushed the last bar onto TOMORROW, which is always empty.
 */

function loadFor(timezone: string) {
  return load({
    locals: { user: { id: "u1", timezone }, session: { id: "s1" } },
  } as never) as Promise<{ medications: Array<{ id: string; sparkline: number[] }> }>;
}

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
  await pgDb.seedMedication();
});

describe("the sparkline covers 14 consecutive days ending today", () => {
  it.each([
    // A `now` inside the band where the old anchor arithmetic drifted: late
    // evening after an autumn fall-back, and just after midnight following a
    // spring-forward.
    ["America/New_York", "2026-11-05T23:30:00Z"],
    ["Europe/London", "2026-10-26T23:30:00Z"],
    ["Europe/London", "2026-04-05T00:30:00Z"],
    ["Pacific/Auckland", "2026-04-10T11:30:00Z"],
    ["Australia/Lord_Howe", "2026-10-10T13:30:00Z"],
    ["UTC", "2026-06-15T12:00:00Z"],
  ])("%s at %s", async (timezone, nowIso) => {
    vi.setSystemTime(new Date(nowIso));

    // Today's dose is the probe: it can only land in the last bucket if the
    // series actually ends on today. If the anchor drifts forward the last
    // bar is tomorrow and this dose falls one short of the end; if it drifts
    // back, today is outside the window entirely and the count is lost.
    await pgDb.seedDose({ id: "today", takenAt: new Date(nowIso), quantity: 1 });

    const { medications } = await loadFor(timezone);
    const sparkline = medications[0].sparkline;

    expect(sparkline).toHaveLength(14);
    expect(sparkline.at(-1)).toBe(1);
    expect(sparkline.reduce((sum, n) => sum + n, 0)).toBe(1);
  });

  it("a dose 13 days back lands in the FIRST bucket, so the window is exactly 14 days", async () => {
    vi.setSystemTime(new Date("2026-11-05T18:00:00Z"));
    // 2026-10-23 13:00 in New York, 13 civil days before 2026-11-05.
    await pgDb.seedDose({ id: "oldest", takenAt: new Date("2026-10-23T17:00:00Z") });

    const { medications } = await loadFor("America/New_York");

    expect(medications[0].sparkline[0]).toBe(1);
    expect(medications[0].sparkline.reduce((sum, n) => sum + n, 0)).toBe(1);
  });

  it("a dose 14 days back falls outside the window", async () => {
    vi.setSystemTime(new Date("2026-11-05T18:00:00Z"));
    await pgDb.seedDose({ id: "too-old", takenAt: new Date("2026-10-22T17:00:00Z") });

    const { medications } = await loadFor("America/New_York");

    expect(medications[0].sparkline.reduce((sum, n) => sum + n, 0)).toBe(0);
  });

  it("counts doses on the transition day once, not twice", async () => {
    // The duplicated key made the transition day's bar appear in two buckets.
    vi.setSystemTime(new Date("2026-11-05T18:00:00Z"));
    await pgDb.seedDose({ id: "on-transition", takenAt: new Date("2026-11-01T17:00:00Z") });

    const { medications } = await loadFor("America/New_York");
    const nonZero = medications[0].sparkline.filter((n) => n > 0);

    expect(nonZero).toEqual([1]);
  });
});
