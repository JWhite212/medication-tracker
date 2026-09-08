// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. Same
// reason as tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import type { ScheduleSlot, ScheduleSlotStatus } from "$lib/utils/schedule";

// The row's quick-log form imports `enhance` and the toast store; neither is
// reachable on the server and neither is what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

const { default: MyDayTimeline } = await import("../../src/lib/components/MyDayTimeline.svelte");

/**
 * The timeline's status marker is the ONLY thing that says whether a dose was
 * taken, skipped, is overdue, or is still to come — the row's visible text is
 * just the medication name, its dose and the expected time. So the icon's
 * accessible name is load-bearing, not decorative.
 *
 * It was an `aria-label` on a bare `<span>`, which is prohibited: a span has
 * the implicit `generic` role, and `generic` does not support naming, so the
 * label is DISCARDED rather than announced. Confirmed on production by
 * Lighthouse (`aria-prohibited-attr`, nine failing nodes on /dashboard) — a
 * screen-reader user was told nothing at all about a dose's state.
 */

function slot(status: ScheduleSlotStatus, overrides: Partial<ScheduleSlot> = {}): ScheduleSlot {
  return {
    medicationId: `m-${status}`,
    medicationName: `Med ${status}`,
    colour: "#ffffff",
    colourSecondary: null,
    pattern: "solid",
    dosageAmount: "1",
    dosageUnit: "mg",
    // Fixed instant so the slot always lands in the same time-of-day group.
    expectedTime: "2026-05-01T09:00:00.000Z",
    status,
    matchedDoseId: null,
    ...overrides,
  };
}

function renderTimeline(slots: ScheduleSlot[]): string {
  return render(MyDayTimeline, {
    props: { scheduleSlots: slots, timezone: "UTC", timeFormat: "24h" as const },
  }).body;
}

const STATUSES: Array<{ status: ScheduleSlotStatus; label: string }> = [
  { status: "taken", label: "Taken" },
  { status: "skipped", label: "Skipped" },
  { status: "overdue", label: "Overdue" },
  { status: "upcoming", label: "Upcoming" },
];

describe("the My Day timeline's status marker", () => {
  for (const { status, label } of STATUSES) {
    it(`gives the ${status} marker a name assistive technology will actually read`, () => {
      const html = renderTimeline([slot(status)]);

      // The label has to survive...
      expect(html).toContain(`aria-label="${label}"`);
      // ...on an element whose role permits being named. A bare span does not:
      // `generic` prohibits naming, so the attribute is dropped on the floor.
      const marker = html.match(new RegExp(`<span[^>]*aria-label="${label}"[^>]*>`))?.[0];
      expect(marker, `no element carries aria-label="${label}"`).toBeDefined();
      expect(marker).toContain('role="img"');
    });
  }

  it("names every status the component can render, with no bare-span labels left", () => {
    const html = renderTimeline(STATUSES.map(({ status }) => slot(status)));

    for (const { label } of STATUSES) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    // The property in general, so a fifth status added later cannot quietly
    // reintroduce the defect: no aria-label may sit on an element that has no
    // role attribute at all.
    const labelled = html.match(/<span(?![^>]*\brole=)[^>]*\saria-label=/g) ?? [];
    expect(labelled, `spans carrying aria-label without a role: ${labelled.join(", ")}`).toEqual(
      [],
    );
  });

  // The assertions above are a proxy for the rule; this one IS the rule.
  // `aria-prohibited-attr` is what failed on production, so running axe's own
  // implementation removes the risk that a hand-written pattern agrees with
  // the markup while disagreeing with the checker users are actually judged by.
  it("passes axe's own aria-prohibited-attr rule", async () => {
    const { JSDOM } = await import("jsdom");
    const axe = (await import("axe-core")).default;

    const dom = new JSDOM(
      `<!doctype html><html lang="en"><body>${renderTimeline(
        STATUSES.map(({ status }) => slot(status)),
      )}</body></html>`,
    );
    // axe reads these off the global at run time; this file is a `node`
    // environment, so they have to be put there and taken back off.
    const g = globalThis as unknown as Record<string, unknown>;
    const [prevWindow, prevDocument] = [g.window, g.document];
    g.window = dom.window;
    g.document = dom.window.document;
    try {
      const results = await axe.run(dom.window.document.body, {
        runOnly: { type: "rule", values: ["aria-prohibited-attr"] },
      });
      const offenders = results.violations.flatMap((v) => v.nodes.map((n) => n.html));
      expect(offenders, offenders.join("\n")).toEqual([]);
      // Guard the guard: if the rule ever stops being evaluated — renamed,
      // dropped, or the markup stops containing a candidate — an empty
      // violations list would pass vacuously.
      expect(results.passes.length + results.violations.length).toBeGreaterThan(0);
    } finally {
      g.window = prevWindow;
      g.document = prevDocument;
    }
  });
});
