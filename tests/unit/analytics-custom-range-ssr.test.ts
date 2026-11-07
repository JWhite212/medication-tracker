// @vitest-environment node
//
// `@vitest-environment node`: under jsdom vite resolves `svelte` to its
// client entry and `render()` from `svelte/server` throws before an
// assertion runs (see analytics-page-ssr.test.ts).
import { describe, it, expect } from "vitest";
import type { ComponentProps } from "svelte";
import { render } from "svelte/server";
import Page from "../../src/routes/(app)/analytics/+page.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";
import { preferencesFixture } from "./helpers/preferences-fixture";

/**
 * With a custom From/To range the page must describe THAT range: no preset
 * Toggle pressed, every period label naming the dates, and a heatmap that
 * spans the range rather than the last N days ending today. The preset case
 * is held, unchanged, by analytics-page-ssr.test.ts.
 */

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

function pageFor(dateFormat: string) {
  const data = {
    user,
    preferences: { ...preferencesFixture, dateFormat },
    insights: [],
    medications: [],
    selectedMedIds: [],
    period: 30,
    range: { fromKey: "2026-01-01", toKey: "2026-01-31", days: 31 },
    from: "2026-01-01",
    to: "2026-01-31",
    streak: 0,
    avgAdherence: 80,
    totalDoses: 40,
    trends: {
      adherence: { direction: "flat", percent: 0 },
      doses: { direction: "flat", percent: 0 },
      perMedication: [],
    },
    dailyAdherence: [],
    dailyCounts: [{ date: "2026-01-15", count: 3 }],
    medStats: [],
    statusBreakdown: { takenEvents: 0, skippedEvents: 0, missedEvents: 0, expectedTotal: 0 },
    dayOfWeek: [],
    hourly: [],
    scheduledHours: [],
    scheduleVariance: null,
    sideEffects: { frequency: [], byMedication: [] },
  } as unknown as ComponentProps<typeof Page>["data"];
  return ssrDocument(render(Page, { props: { data } }).body);
}

describe("the analytics page under a custom range", () => {
  const doc = pageFor("DD/MM/YYYY");

  it("presses no preset Toggle", () => {
    const toggles = [...doc.querySelectorAll("button")].filter((b) =>
      ["7d", "30d", "90d", "1y"].includes(textOf(b)),
    );
    expect(toggles).toHaveLength(4);
    expect(toggles.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
      "false",
    ]);
  });

  it("labels every window with the range, never the preset period", () => {
    const text = textOf(doc.body);
    expect(text).toContain("Doses (1 Jan 2026 – 31 Jan 2026)");
    const headings = [...doc.querySelectorAll("h2")].map(textOf);
    expect(headings).toContain("Activity (1 Jan 2026 – 31 Jan 2026)");
    expect(headings).toContain("Per-Medication Adherence (1 Jan 2026 – 31 Jan 2026)");
    expect(text).not.toContain("30 days");
  });

  it("heatmaps the range's own days, so its counts are visible", () => {
    const cells = [...doc.querySelectorAll(".heatmap-cell")].map((c) =>
      c.getAttribute("aria-label"),
    );
    expect(cells).toHaveLength(31);
    expect(cells[0]).toBe("1 Jan 2026: 0 doses logged");
    expect(cells.at(-1)).toBe("31 Jan 2026: 0 doses logged");
    expect(cells).toContain("15 Jan 2026: 3 doses logged");
  });

  it("formats the range through the date-format preference", () => {
    const iso = textOf(pageFor("YYYY-MM-DD").body);
    expect(iso).toContain("Doses (2026-01-01 – 2026-01-31)");
  });
});
