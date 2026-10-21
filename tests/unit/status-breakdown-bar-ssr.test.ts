// @vitest-environment node
//
// `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import StatusBreakdownBar, {
  STATUS_BREAKDOWN_FILLS,
  statusBreakdownSegments,
} from "$lib/components/StatusBreakdownBar.svelte";
import { toneClass } from "$lib/utils/status-tone";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

// 6 / 3 / 1 of 10: whole percentages, so the split needs no tolerance.
const COUNTS = { takenEvents: 6, skippedEvents: 3, missedEvents: 1, expectedTotal: 10 };
const fill = (el: Element) => [...el.classList].find((c) => c.startsWith("bg-"));

function renderCard(): Document {
  return ssrDocument(render(StatusBreakdownBar, { props: COUNTS }).body);
}

function card() {
  const doc = renderCard();
  const [bar, legend] = doc.querySelector("h2")!.nextElementSibling!.children;
  return { bar, legend };
}

describe("StatusBreakdownBar", () => {
  it("takes its fills from the status owner: taken happened, skipped neutral, missed wrong", () => {
    expect(STATUS_BREAKDOWN_FILLS).toEqual({
      taken: toneClass("happened", "bar"),
      skipped: toneClass("neutral", "bar"),
      missed: toneClass("wrong", "bar"),
    });
  });

  it("draws the bar's segments in taken, skipped, missed order with those fills", () => {
    const { bar } = card();
    expect([...bar.children].map(fill)).toEqual([
      STATUS_BREAKDOWN_FILLS.taken,
      STATUS_BREAKDOWN_FILLS.skipped,
      STATUS_BREAKDOWN_FILLS.missed,
    ]);
    expect([...bar.children].map((el) => (el as HTMLElement).style.width)).toEqual([
      "60%",
      "30%",
      "10%",
    ]);
  });

  it("gives the legend's dots the same fills and keeps its words", () => {
    const { legend } = card();
    const dots = [...legend.querySelectorAll('[aria-hidden="true"]')].map(fill);
    expect(dots).toEqual([
      STATUS_BREAKDOWN_FILLS.taken,
      STATUS_BREAKDOWN_FILLS.skipped,
      STATUS_BREAKDOWN_FILLS.missed,
    ]);
    expect([...legend.children].map(textOf)).toEqual([
      "Taken 6",
      "Skipped 3",
      "Missed 1",
      "10 expected",
    ]);
  });

  it("splits the bar exactly as before", () => {
    expect(statusBreakdownSegments(COUNTS)).toEqual({
      takenPct: 60,
      skippedPct: 30,
      missedPct: 10,
    });
    // Whole percentages need no rounding, so thirds pin it: two of three
    // rounds to 66.7, and missed takes the remainder.
    expect(statusBreakdownSegments({ takenEvents: 2, skippedEvents: 0, missedEvents: 1 })).toEqual({
      takenPct: 66.7,
      skippedPct: 0,
      missedPct: 33.3,
    });
  });

  it("passes axe: aria-hidden-focus, empty-heading", async () => {
    const rules = ["aria-hidden-focus", "empty-heading"];
    const results = await runAxe(renderCard(), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});
