// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/appearance-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import type { ComponentProps } from "svelte";
import { render } from "svelte/server";
import Page from "../../src/routes/(app)/analytics/+page.svelte";
import { ssrDocument, runAxe, evaluatedRules } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";
import { STATUS_TOKEN } from "./helpers/status-token";

/**
 * Analytics reports numbers; it does not judge them. A 42% average printed
 * green, a decline printed red, and the dose count printed amber, so amber
 * meant "a number" on this page and "needs you" on the dashboard. Now the
 * headline numbers, their trends and sparklines, the per-medication trends
 * and the side-effect counts are neutral, and the page has no status colour
 * at all unless an insight needs the reader.
 */

const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

// Contributed by the (app) layout load. The page reads timezone from it.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

// Cast once: the page's PageData is drizzle-inferred and only the fields it
// reads matter here (walkthrough-demo-facts.test.ts casts its composer inputs
// the same way).
const data = {
  user,
  preferences,
  insights: [],
  medications: [],
  selectedMedIds: [],
  period: 90,
  from: "",
  to: "",
  streak: 12,
  avgAdherence: 42,
  totalDoses: 118,
  trends: {
    adherence: { direction: "down", percent: 4 },
    doses: { direction: "up", percent: 9 },
    perMedication: [{ medicationId: "m1", trend: { direction: "down", percent: 6 } }],
  },
  dailyAdherence: [
    { date: "2026-10-14", doseCount: 2, expected: 3, adherence: 67 },
    { date: "2026-10-15", doseCount: 3, expected: 3, adherence: 100 },
  ],
  dailyCounts: [],
  medStats: [
    {
      medicationId: "m1",
      medicationName: "Ibuprofen",
      colour: "#ef4444",
      adherence: 31,
      doseCount: 28,
      expectedTotal: 90,
    },
  ],
  // All zero, so StatusBreakdownBar renders nothing and the whole-page scan is about this page.
  statusBreakdown: { takenEvents: 0, skippedEvents: 0, missedEvents: 0, expectedTotal: 0 },
  dayOfWeek: [],
  hourly: [],
  scheduledHours: [],
  scheduleVariance: null,
  sideEffects: {
    frequency: [
      { name: "Nausea", count: 4 },
      { name: "Headache", count: 2 },
    ],
    byMedication: [{ medication: "Ibuprofen", effects: [{ name: "Nausea", count: 4 }] }],
  },
} as unknown as ComponentProps<typeof Page>["data"];

const html = render(Page, { props: { data } }).body;
const doc = ssrDocument(html);
const tokensOf = (el: Element) => [...el.classList];

describe("the analytics page", () => {
  it("renders no status colour when nothing on the page needs you", () => {
    // The raw markup, not just class lists, so an inline var(--color-…) cannot hide either.
    // STATUS_TOKEN is global: read it with match, never test.
    expect(html.match(STATUS_TOKEN) ?? []).toEqual([]);
  });

  it("prints the three headline numbers in plain text, never the accent", () => {
    for (const n of ["12", "42%", "118"]) {
      const p = [...doc.querySelectorAll("p")].find((el) => textOf(el) === n);
      expect(tokensOf(p!), n).toContain("text-text-primary");
      expect(tokensOf(p!), n).not.toContain("text-accent-ink");
    }
  });

  it("shows every trend as a neutral arrow and percentage", () => {
    for (const t of ["↓4%", "↑9%", "↓6%"]) {
      const span = [...doc.querySelectorAll("span")].find((el) => textOf(el) === t);
      expect(tokensOf(span!), t).toContain("text-text-secondary");
    }
  });

  it("draws both headline sparklines in the neutral ink", () => {
    for (const label of ["Daily adherence over period", "Daily doses over period"]) {
      const svg = doc.querySelector(`svg[aria-label="${label}"]`);
      expect(tokensOf(svg!.parentElement!), label).toContain("text-text-secondary");
    }
  });

  it("offers the four periods as Toggles, only the current one pressed", () => {
    const toggles = [...doc.querySelectorAll("button")].filter((b) =>
      ["7d", "30d", "90d", "1y"].includes(textOf(b)),
    );
    expect(toggles.map(textOf)).toEqual(["7d", "30d", "90d", "1y"]);
    expect(toggles.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "true",
      "false",
    ]);
    for (const b of toggles) {
      expect(b.getAttribute("type")).toBe("button");
      expect(tokensOf(b)).toContain("h-9");
      expect(tokensOf(b)).not.toContain("bg-accent");
    }
    expect(tokensOf(toggles[2])).toEqual(
      expect.arrayContaining(["border-accent-ink", "bg-accent/15", "text-accent-ink"]),
    );
    expect(tokensOf(toggles[0])).toEqual(
      expect.arrayContaining(["border-border-strong", "text-text-secondary"]),
    );
  });

  it("draws side-effect frequency as neutral bars and chips", () => {
    const card = [...doc.querySelectorAll("h2")].find(
      (h) => textOf(h) === "Side Effects",
    )!.parentElement!;
    const fills = [...card.querySelectorAll("[style*='width']")];
    expect(fills).toHaveLength(2);
    for (const f of fills) expect(tokensOf(f)).toContain("bg-border-strong");
    const chip = [...card.querySelectorAll("span")].find((s) => textOf(s) === "Nausea (4)");
    expect(tokensOf(chip!)).toEqual(
      expect.arrayContaining(["border-border-strong", "text-text-secondary"]),
    );
  });

  it("passes axe on names and ARIA", async () => {
    const rules = ["button-name", "aria-allowed-attr", "aria-valid-attr-value", "role-img-alt"];
    const results = await runAxe(doc, rules);
    expect(results.violations).toEqual([]);
    expect(evaluatedRules(results)).toEqual(new Set(rules));
  });
});
