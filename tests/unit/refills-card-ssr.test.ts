// @vitest-environment node
//
// RefillsCard's exported rules, which MedicationCard and the walkthrough also
// read, and the card they draw. `node` is load-bearing: see
// tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import RefillsCard, {
  refillChip,
  refillDaysLabel,
  refillDosesLabel,
  refillSeverityClass,
  refillSeverityLabel,
  type RefillChip,
  type RefillChipInput,
} from "$lib/components/RefillsCard.svelte";
import { toneClass } from "$lib/utils/status-tone";
import type { RefillForecastEntry, RefillSeverity } from "$lib/types";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { accessibleName, textOf } from "./helpers/dom-names";

const SEVERITIES: RefillSeverity[] = ["critical", "warning", "watch", "ok"];
const STATUS_LITERAL = /\b(?:text|bg|border)-(?:info|danger|danger-ink)(?:\/\d+)?\b/;

const input = (over: Partial<RefillChipInput>): RefillChipInput => ({
  severity: "ok",
  daysUntilRefill: null,
  inventoryCount: null,
  inventoryAlertThreshold: null,
  ...over,
});
const amber = (text: string): RefillChip => ({ tone: "needs-you", glyph: "▲", text });

describe("refillChip: the one rule for a refill or stock chip", () => {
  const CASES: [string, Partial<RefillChipInput>, RefillChip | null][] = [
    [
      "critical",
      { severity: "critical", daysUntilRefill: 2, inventoryCount: 4 },
      amber("Reorder soon · 2 days left"),
    ],
    [
      "critical, one day",
      { severity: "critical", daysUntilRefill: 1, inventoryCount: 2 },
      amber("Reorder soon · 1 day left"),
    ],
    [
      "critical, out today",
      { severity: "critical", daysUntilRefill: 0, inventoryCount: 0 },
      amber("Reorder soon · Out today"),
    ],
    [
      "warning",
      { severity: "warning", daysUntilRefill: 6, inventoryCount: 12, inventoryAlertThreshold: 5 },
      amber("Reorder soon · 6 days left"),
    ],
    [
      "watch",
      { severity: "watch", daysUntilRefill: 10, inventoryCount: 20, inventoryAlertThreshold: 5 },
      { tone: "neutral", glyph: null, text: "10 days left" },
    ],
    [
      "ok",
      { severity: "ok", daysUntilRefill: 30, inventoryCount: 60, inventoryAlertThreshold: 5 },
      null,
    ],
    [
      "ok, at the alert threshold",
      { severity: "ok", daysUntilRefill: 30, inventoryCount: 5, inventoryAlertThreshold: 5 },
      amber("Reorder soon · 30 days left"),
    ],
    [
      "ok, one above the threshold",
      { severity: "ok", daysUntilRefill: 30, inventoryCount: 6, inventoryAlertThreshold: 5 },
      null,
    ],
    [
      "watch, below the threshold",
      { severity: "watch", daysUntilRefill: 12, inventoryCount: 3, inventoryAlertThreshold: 5 },
      amber("Reorder soon · 12 days left"),
    ],
    [
      "low, no forecast",
      { inventoryCount: 4, inventoryAlertThreshold: 5 },
      amber("Reorder soon · 4 doses left"),
    ],
    [
      "low, no forecast, one dose",
      { inventoryCount: 1, inventoryAlertThreshold: 5 },
      amber("Reorder soon · 1 dose left"),
    ],
    [
      "empty, threshold 0",
      { inventoryCount: 0, inventoryAlertThreshold: 0 },
      amber("Reorder soon · None left"),
    ],
    ["untracked", { inventoryAlertThreshold: 5 }, null],
    ["no threshold, no forecast", { inventoryCount: 4 }, null],
  ];
  for (const [name, over, expected] of CASES) {
    it(name, () => expect(refillChip(input(over))).toEqual(expected));
  }

  it("counts doses in words", () => {
    expect([0, 1, 4].map(refillDosesLabel)).toEqual(["None left", "1 dose left", "4 doses left"]);
  });

  it("keeps the days wording", () => {
    expect([null, -1, 0, 1, 10].map(refillDaysLabel)).toEqual([
      "Refill needed",
      "Out today",
      "Out today",
      "1 day left",
      "10 days left",
    ]);
  });
});

describe("the row tint and label colour", () => {
  it("are amber for both critical and warning: nothing has gone wrong yet, you need to reorder", () => {
    for (const s of ["critical", "warning"] as const) {
      expect(refillSeverityClass(s)).toBe(toneClass("needs-you", "alert"));
      expect(refillSeverityLabel(s)).toBe(toneClass("needs-you", "text"));
    }
  });

  it("are neutral for watch and ok, a glass row like the dashboard's other cards", () => {
    for (const s of ["watch", "ok"] as const) {
      expect(refillSeverityClass(s)).toBe("border-glass-border bg-glass");
      expect(refillSeverityLabel(s)).toBe(toneClass("neutral", "text"));
    }
  });

  it("never return the info or danger colours", () => {
    for (const s of SEVERITIES) {
      expect(`${refillSeverityClass(s)} ${refillSeverityLabel(s)}`).not.toMatch(STATUS_LITERAL);
    }
  });
});

describe("RefillsCard", () => {
  const entry = (
    id: string,
    severity: RefillSeverity,
    days: number,
    count: number,
  ): RefillForecastEntry => ({
    medicationId: id,
    medicationName: id,
    colour: "#e46b6b",
    inventoryCount: count,
    dailyRate: 1,
    daysUntilRefill: days,
    severity,
  });
  const doc = ssrDocument(
    render(RefillsCard, {
      props: {
        entries: [
          entry("Ibuprofen", "critical", 2, 2),
          entry("Lisinopril", "warning", 6, 6),
          entry("Vitamin D", "watch", 10, 10),
        ],
      },
    }).body,
  );
  const rows = [...doc.querySelectorAll<HTMLAnchorElement>("section a")];
  const label = (a: Element) => a.querySelector(":scope > span:last-child")!;
  const has = (el: Element, recipe: string) =>
    expect([...el.classList]).toEqual(expect.arrayContaining(recipe.split(" ")));

  it("says Reorder soon on an amber row for critical and warning, with ▲ hidden from screen readers", () => {
    for (const [i, days] of [
      [0, 2],
      [1, 6],
    ]) {
      has(rows[i], toneClass("needs-you", "alert"));
      has(label(rows[i]), toneClass("needs-you", "text"));
      expect(accessibleName(label(rows[i]))).toBe(`Reorder soon · ${days} days left`);
      expect(textOf(label(rows[i]))).toBe(`▲ Reorder soon · ${days} days left`);
      expect(label(rows[i]).querySelector('[aria-hidden="true"]')?.textContent).toBe("▲");
    }
    expect(accessibleName(rows[0])).toBe("Ibuprofen Reorder soon · 2 days left");
  });

  it("draws the watch row neutral with only the days left", () => {
    has(rows[2], "border-glass-border bg-glass");
    has(label(rows[2]), toneClass("neutral", "text"));
    expect(accessibleName(label(rows[2]))).toBe("10 days left");
    expect(label(rows[2]).querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("paints no info or danger anywhere", () => {
    expect(doc.body.innerHTML).not.toMatch(STATUS_LITERAL);
  });

  it("passes axe on the rows' names and on the hidden ▲", async () => {
    // jsdom has no layout or CSS, so colour-contrast is measured in
    // theme-tokens.test.ts instead.
    const rules = ["link-name", "aria-hidden-focus", "aria-allowed-attr"];
    const results = await runAxe(doc, rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});
