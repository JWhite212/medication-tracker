import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHeatmapDays } from "$lib/utils/heatmap";

/**
 * The heatmap's anchor ("today") must be a key BUILT from parts, never
 * borrowed from en-CA's short-date pattern. That pattern is CLDR data and may
 * legitimately render `11/06/2026` on the viewer's browser ICU; the module
 * runs client-side, so the grid must survive it.
 *
 * Simulate such an ICU: en-CA's `format()` reorders fields, while
 * `formatToParts()` (specified per field) is untouched.
 */
const RealDTF = Intl.DateTimeFormat;

class ReorderedEnCa extends RealDTF {
  override format(date?: Date | number): string {
    if (!this.resolvedOptions().locale.startsWith("en-CA")) {
      return super.format(date);
    }
    const parts = super.formatToParts(date);
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("month")}/${get("day")}/${get("year")}`;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildHeatmapDays under a reordered en-CA pattern", () => {
  it("still ends on today's ISO key with the right weekday", () => {
    vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: ReorderedEnCa });

    const now = new Date("2026-11-06T10:00:00Z"); // Friday
    const days = buildHeatmapDays(7, "Europe/London", now);

    expect(days).toHaveLength(7);
    expect(days.at(-1)).toEqual({ date: "2026-11-06", row: 5 });
    expect(days[0]).toEqual({ date: "2026-10-31", row: 6 });
    for (const d of days) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
