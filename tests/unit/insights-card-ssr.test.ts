// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/appearance-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import InsightsCard from "../../src/lib/components/InsightsCard.svelte";
import type { Insight } from "$lib/types";
import { ssrDocument, runAxe, evaluatedRules } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";
import { STATUS_TOKEN } from "./helpers/status-token";

/**
 * An insight is a glyph and a sentence. The old card drew a 2px coloured dot
 * and nothing else, so a decline and a streak differed only by hue. Now the
 * glyph points the way, the sentence says it, and only the insight that needs
 * the reader (the refill) is coloured.
 */

const INSIGHTS: Insight[] = [
  {
    id: "refill-warning",
    signal: "needs-you",
    lead: "Reorder soon",
    text: "2 medications run out within 7 days",
  },
  { id: "lowest-adherence-med", signal: "down", text: "Lowest adherence: Ibuprofen (31%)" },
  { id: "highest-adherence-med", signal: "up", text: "Highest adherence: Vitamin D (44%)" },
  { id: "peak-hour", signal: "info", text: "Most consistent dosing time is 08:00" },
];

const docOf = (insights: Insight[]) =>
  ssrDocument(render(InsightsCard, { props: { insights } }).body);
const items = () => [...docOf(INSIGHTS).querySelectorAll("li")];

/** The status colour tokens on one element. STATUS_TOKEN is global: read it with match, never test. */
const statusTokens = (el: Element) => el.getAttribute("class")?.match(STATUS_TOKEN) ?? [];

/** What a screen reader reads: the item without its aria-hidden glyph. */
function spoken(li: Element): string {
  const clone = li.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return textOf(clone);
}

describe("InsightsCard", () => {
  it("renders nothing without insights", () => {
    expect(docOf([]).querySelector("h2")).toBeNull();
  });

  it("marks each insight with a hidden glyph: ▲ needs you, ↓ down, ↑ up, • info", () => {
    const glyphs = items().map((li) => li.firstElementChild!);
    expect(glyphs.map(textOf)).toEqual(["▲", "↓", "↑", "•"]);
    for (const g of glyphs) expect(g.getAttribute("aria-hidden")).toBe("true");
  });

  it("says the actionable insight in words, with a bold Reorder soon: lead-in", () => {
    const [refill, ...rest] = items();
    expect(spoken(refill)).toBe("Reorder soon: 2 medications run out within 7 days");
    const lead = [...refill.querySelectorAll("span")].find((s) => textOf(s) === "Reorder soon:");
    expect([...lead!.classList]).toEqual(expect.arrayContaining(["font-semibold", "text-warning"]));
    for (const li of rest) expect(spoken(li)).not.toContain("Reorder soon");
  });

  it("colours only the actionable insight, amber, and draws no colour-only dot", () => {
    const [refill, ...rest] = items();
    expect([...refill.firstElementChild!.classList]).toContain("text-warning");
    for (const li of rest) {
      expect([...li.firstElementChild!.classList]).toContain("text-text-secondary");
      expect([li, ...li.querySelectorAll("*")].flatMap(statusTokens)).toEqual([]);
    }
    const filled = items()
      .flatMap((li) => [...li.querySelectorAll("*")])
      .filter((el) => [...el.classList].some((t) => t.startsWith("bg-")));
    expect(filled).toEqual([]);
  });

  it("passes axe's listitem and aria-hidden-focus rules", async () => {
    const results = await runAxe(docOf(INSIGHTS), ["listitem", "aria-hidden-focus"]);
    expect(results.violations).toEqual([]);
    expect(evaluatedRules(results)).toEqual(new Set(["listitem", "aria-hidden-focus"]));
  });
});
