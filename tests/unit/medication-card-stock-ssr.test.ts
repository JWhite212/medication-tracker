// @vitest-environment node
//
// The medications card's one stock chip. `node` is load-bearing: see
// tests/unit/medication-card-targets-ssr.test.ts's header.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { MedicationWithStats } from "$lib/types";
import MedicationCard from "../../src/lib/components/MedicationCard.svelte";
import { toneClass } from "$lib/utils/status-tone";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { accessibleName, textOf } from "./helpers/dom-names";

type Listed = MedicationWithStats & {
  sparkline: number[];
  refillSeverity: "critical" | "warning" | "watch" | "ok";
};
type Stock = Pick<
  Listed,
  "refillSeverity" | "daysUntilRefill" | "inventoryCount" | "inventoryAlertThreshold"
>;

const STATUS = /\b(?:text|bg|border|ring)-(?:warning|success|danger|danger-ink|info)(?:\/\d+)?\b/;

function card(stock: Stock): Document {
  const medication: Listed = {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    expectedDailyDoses: 3,
    sparkline: [1, 2, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3],
    ...stock,
  };
  return ssrDocument(
    render(MedicationCard, {
      props: { medication, timezone: "UTC", timeFormat: "24h" },
      context: doseWriteContext(),
    }).body,
  );
}
const chips = (doc: Document) => [...doc.querySelectorAll("[data-stock-chip]")];
const has = (el: Element, recipe: string) =>
  expect([...el.classList]).toEqual(expect.arrayContaining(recipe.split(" ")));

const CRITICAL: Stock = {
  refillSeverity: "critical",
  daysUntilRefill: 3,
  inventoryCount: 9,
  inventoryAlertThreshold: 2,
};
const WARNING: Stock = {
  refillSeverity: "warning",
  daysUntilRefill: 7,
  inventoryCount: 21,
  inventoryAlertThreshold: 2,
};
const WATCH: Stock = {
  refillSeverity: "watch",
  daysUntilRefill: 10,
  inventoryCount: 20,
  inventoryAlertThreshold: 5,
};
const FINE: Stock = {
  refillSeverity: "ok",
  daysUntilRefill: 60,
  inventoryCount: 120,
  inventoryAlertThreshold: 5,
};

describe("the medication card's stock chip", () => {
  it("is one amber Reorder soon chip for a critical forecast, ▲ hidden from screen readers", () => {
    const doc = card(CRITICAL);
    expect(chips(doc)).toHaveLength(1);
    const [chip] = chips(doc);
    expect(accessibleName(chip)).toBe("Reorder soon · 3 days left");
    // The space after ▲ is visible text; Svelte drops a literal one at an {#if} edge.
    expect(textOf(chip)).toBe("▲ Reorder soon · 3 days left");
    expect(chip.querySelector('[aria-hidden="true"]')?.textContent).toBe("▲");
    has(chip, toneClass("needs-you", "chip"));
  });

  it("is the same chip, not a second Low one, when stock is at the user's alert threshold", () => {
    const doc = card({
      refillSeverity: "ok",
      daysUntilRefill: 30,
      inventoryCount: 5,
      inventoryAlertThreshold: 5,
    });
    expect(chips(doc)).toHaveLength(1);
    expect(accessibleName(chips(doc)[0])).toBe("Reorder soon · 30 days left");
    expect(textOf(doc.body)).not.toContain("Low:");
  });

  it("counts doses in the chip, and only there, when there is no forecast", () => {
    const doc = card({
      refillSeverity: "ok",
      daysUntilRefill: null,
      inventoryCount: 4,
      inventoryAlertThreshold: 5,
    });
    expect(accessibleName(chips(doc)[0])).toBe("Reorder soon · 4 doses left");
    expect(textOf(doc.body).split("4 doses left")).toHaveLength(2);
  });

  it("is a neutral N days left chip for the watch tier", () => {
    const [chip] = chips(card(WATCH));
    expect(accessibleName(chip)).toBe("10 days left");
    expect(chip.querySelector('[aria-hidden="true"]')).toBeNull();
    has(chip, toneClass("neutral", "chip"));
  });

  it("has no chip when supply is fine, and keeps the days of supply in the stats row", () => {
    const doc = card(FINE);
    expect(chips(doc)).toHaveLength(0);
    expect(textOf(doc.body)).toContain("~60d supply left");
    expect(textOf(doc.body)).not.toContain("doses left");
  });

  it("puts no status colour anywhere on the card except the chip, at any tier", () => {
    for (const stock of [CRITICAL, WARNING, WATCH, FINE]) {
      const doc = card(stock);
      const coloured = [...doc.querySelectorAll("[class]")].filter(
        (el) => STATUS.test(el.getAttribute("class")!) && !el.closest("[data-stock-chip]"),
      );
      expect(
        coloured.map((el) => el.outerHTML),
        stock.refillSeverity,
      ).toEqual([]);
    }
  });

  it("passes axe on the card with the amber and the neutral chip", async () => {
    // jsdom has no layout or CSS, so colour-contrast is measured in
    // theme-tokens.test.ts instead.
    const rules = ["link-name", "button-name", "aria-hidden-focus", "nested-interactive"];
    for (const stock of [CRITICAL, WATCH]) {
      const results = await runAxe(card(stock), rules);
      const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
      expect(offenders, offenders.join("\n")).toEqual([]);
      // Only the amber chip holds an aria-hidden element (its ▲), so only
      // there has aria-hidden-focus anything to evaluate.
      for (const rule of stock === CRITICAL ? rules : rules.slice(0, 2)) {
        expect(evaluatedRules(results).has(rule), `${stock.refillSeverity} ${rule}`).toBe(true);
      }
    }
  });
});
