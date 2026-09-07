import { describe, it, expect } from "vitest";
import { buildHeatmapDays } from "$lib/utils/heatmap";

describe("buildHeatmapDays", () => {
  it("keys on the civil date in the user's timezone, not the runtime's", () => {
    // 10:00Z on the 15th is still the 14th in Los Angeles (UTC-7) but already
    // the 15th in London. The old implementation took browser-local midnight
    // and read it back with toISOString(), so a user east of UTC got the
    // previous day's key for every cell and the whole grid was off by one.
    const now = new Date("2026-04-15T10:00:00Z");

    expect(buildHeatmapDays(1, "Pacific/Auckland", now)[0].date).toBe("2026-04-15");
    expect(buildHeatmapDays(1, "Europe/London", now)[0].date).toBe("2026-04-15");
    expect(buildHeatmapDays(1, "America/Los_Angeles", now)[0].date).toBe("2026-04-15");

    // 03:00Z is the 15th in London but still the 14th in Los Angeles.
    const earlyUtc = new Date("2026-04-15T03:00:00Z");
    expect(buildHeatmapDays(1, "Europe/London", earlyUtc)[0].date).toBe("2026-04-15");
    expect(buildHeatmapDays(1, "America/Los_Angeles", earlyUtc)[0].date).toBe("2026-04-14");
  });

  it("returns consecutive days, oldest first, ending today", () => {
    const days = buildHeatmapDays(5, "UTC", new Date("2026-04-15T10:00:00Z"));
    expect(days.map((d) => d.date)).toEqual([
      "2026-04-11",
      "2026-04-12",
      "2026-04-13",
      "2026-04-14",
      "2026-04-15",
    ]);
  });

  it("reports the weekday of the civil date, for the grid's row index", () => {
    // 2026-04-15 is a Wednesday (3); the run starts on the Sunday before.
    const days = buildHeatmapDays(4, "UTC", new Date("2026-04-15T10:00:00Z"));
    expect(days.map((d) => d.row)).toEqual([0, 1, 2, 3]);
  });

  it("does not duplicate or skip a day across a DST transition", () => {
    // Europe/London springs forward on 2026-03-29. Anchoring on a local
    // midnight and stepping a fixed 24h lands on 23:00 the previous day and
    // repeats it; anchoring at noon UTC cannot.
    const days = buildHeatmapDays(4, "Europe/London", new Date("2026-03-30T12:00:00Z"));
    expect(days.map((d) => d.date)).toEqual([
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
    ]);
    expect(new Set(days.map((d) => d.date)).size).toBe(4);
  });

  it("does not duplicate or skip a day across a fall-back transition", () => {
    // Europe/London falls back on 2026-10-25 — the 25-hour day.
    const days = buildHeatmapDays(4, "Europe/London", new Date("2026-10-26T12:00:00Z"));
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
    ]);
  });
});
