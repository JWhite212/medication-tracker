// @vitest-environment node
//
// DueCard's SSR markup: what each button posts, what it is called, how tall
// it is, and axe on the result. `node` is load-bearing — see
// tests/unit/error-page-ssr.test.ts.
//
// The card must pass axe's button-name, label-in-name, list and target-size.
// Under JSDOM only some of those work AS AXE RULES, so the rest are asserted
// directly:
//   - axe has no "label-in-name" id; its WCAG 2.5.3 rule
//     (label-content-name-mismatch) is experimental and returns `incomplete`
//     without a canvas. "Every name starts with its visible label" is below.
//   - `list` does not apply to <ul role="list"> (axe's no-role-matches), so
//     `listitem` and `aria-required-children` check the list structure.
//   - `target-size` passes a 10×10px button under JSDOM: nothing has layout.
//     The fixed height classes are asserted instead.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import type { DueCard as DueCardData, DueRow } from "$lib/types";
import { formatSlotTime, rowStatusLine } from "$lib/utils/dashboard-copy";

vi.mock("$app/forms", () => ({
  enhance: () => ({ destroy() {} }),
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$app/state", () => ({ page: { data: {} } }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DueCard from "$lib/components/dashboard/DueCard.svelte";
import { createDoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";
import { dashboardContext } from "./helpers/dashboard-context";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import {
  accessibleName,
  buttonNamed,
  hiddenFields,
  textOf,
  visibleLabel,
} from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const TZ = "UTC";

function row(expectedTime: string, overrides: Partial<DueRow> = {}): DueRow {
  return {
    key: `row@${expectedTime}`,
    kind: "fixed_time",
    expectedTime,
    state: "overdue",
    logNow: false,
    tookItAt: expectedTime,
    skipAt: expectedTime,
    ...overrides,
  };
}

// Top row: due in 30 minutes and the Log-now target. Its Skip is at `now`
// (a skip is never future-dated) and Took it at is absent (composition's
// presentation rule). Nested, latest first: 11:00 overdue with Took it at +
// Skip; 09:00, which the simulations proved offers nothing.
const TODAY_CARD: DueCardData = {
  key: "today:m1",
  medicationId: "m1",
  name: "Metformin",
  dosageAmount: "500",
  dosageUnit: "mg",
  colour: "#6366f1",
  colourSecondary: null,
  pattern: "solid",
  rows: [
    row("2026-05-01T13:30:00.000Z", {
      state: "due-now",
      logNow: true,
      tookItAt: null,
      skipAt: "2026-05-01T13:00:00.000Z",
    }),
    row("2026-05-01T11:00:00.000Z"),
    row("2026-05-01T09:00:00.000Z", { tookItAt: null, skipAt: null }),
  ],
};

const EARLIER_CARD: DueCardData = {
  key: "earlier:m2",
  medicationId: "m2",
  name: "Lisinopril",
  dosageAmount: "10",
  dosageUnit: "mg",
  colour: "#10b981",
  colourSecondary: "#064e3b",
  pattern: "stripes",
  rows: [row("2026-04-30T22:00:00.000Z", { state: "earlier", logNow: true })],
};

const OVERDUE_CARD: DueCardData = {
  ...TODAY_CARD,
  key: "today:m3",
  medicationId: "m3",
  rows: [row("2026-05-01T11:00:00.000Z")],
};

function renderCard(card: DueCardData, lock = createDoseWriteLock()): Document {
  const { body } = render(DueCard, {
    props: {
      card,
      serverNow: NOW,
      todayStart: TODAY_START,
      timezone: TZ,
      timeFormat: "24h",
      focusAfter: () => null,
    },
    context: dashboardContext({ lock, now: NOW }),
  });
  return ssrDocument(`<ul role="list">${body}</ul>`);
}

function cardItem(doc: Document): HTMLLIElement {
  const li = doc.querySelector<HTMLLIElement>("li[data-card-key]");
  if (!li) throw new Error("no card <li> rendered");
  return li;
}

const formOf = (button: HTMLButtonElement) => {
  const form = button.closest("form");
  if (!form) throw new Error(`"${accessibleName(button)}" is not inside a form`);
  return form;
};

const statusLine = (r: DueRow) =>
  rowStatusLine(
    { state: r.state, expectedTime: new Date(r.expectedTime) },
    NOW,
    TODAY_START,
    TZ,
    "24h",
  );

describe("DueCard", () => {
  it("is a focusable list item named by the medication and its dose", () => {
    const li = cardItem(renderCard(TODAY_CARD));
    expect(li.getAttribute("tabindex")).toBe("-1");
    expect(li.dataset.cardKey).toBe("today:m1");
    expect(li.hasAttribute("data-dose-card")).toBe(true);
    expect(li.hasAttribute("aria-busy")).toBe(false);
    const labelledBy = li.getAttribute("aria-labelledby");
    const nameEl = labelledBy ? li.ownerDocument.getElementById(labelledBy) : null;
    expect(nameEl && textOf(nameEl)).toBe("Metformin 500mg");
  });

  it("Log now posts the row's own instant as forSlot, and no takenAt", () => {
    const form = formOf(
      buttonNamed(renderCard(TODAY_CARD), "Log now: Metformin 500mg, 13:30 dose"),
    );
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(hiddenFields(form)).toEqual({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-05-01T13:30:00.000Z",
    });
  });

  it("Took it at posts the slot's instant as takenAt", () => {
    const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Took it at 11:00: Metformin 500mg"));
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(hiddenFields(form)).toEqual({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-05-01T11:00:00.000Z",
    });
  });

  it("Skip posts the shipped skipAt verbatim — for a slot still ahead, that is now", () => {
    const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Skip: Metformin 500mg, 13:30 dose"));
    expect(form.getAttribute("action")).toBe("?/skipDose");
    expect(hiddenFields(form)).toEqual({ medicationId: "m1", takenAt: "2026-05-01T13:00:00.000Z" });
  });

  it("puts Log now first in tab order, then Took it at and Skip, row by row", () => {
    const names = [...renderCard(TODAY_CARD).querySelectorAll("button")].map(accessibleName);
    expect(names).toEqual([
      "Log now: Metformin 500mg, 13:30 dose",
      "Skip: Metformin 500mg, 13:30 dose",
      "Took it at 11:00: Metformin 500mg",
      "Skip: Metformin 500mg, 11:00 dose",
    ]);
  });

  it("keeps Skip out of Log now's column, so a thumb slipping off Log now cannot land on it", () => {
    const doc = renderCard(TODAY_CARD);
    const logNow = formOf(buttonNamed(doc, "Log now: Metformin 500mg, 13:30 dose"));
    const skip = formOf(buttonNamed(doc, "Skip: Metformin 500mg, 13:30 dose"));
    expect(logNow.parentElement).not.toBe(skip.parentElement);
    expect(logNow.contains(skip)).toBe(false);
  });

  it("shows every row's status line; a row proven to offer nothing still shows, with no buttons", () => {
    const doc = renderCard(TODAY_CARD);
    const li = cardItem(doc);
    for (const r of TODAY_CARD.rows) expect(textOf(li)).toContain(statusLine(r));
    const nested = [...li.querySelectorAll("ul > li")];
    const nineOClock = nested.find((el) => textOf(el).includes(statusLine(TODAY_CARD.rows[2])));
    expect(nineOClock).toBeDefined();
    expect(nineOClock!.querySelectorAll("button")).toHaveLength(0);
  });

  it("nests the other rows, latest first, under one name and one glyph", () => {
    const li = cardItem(renderCard(TODAY_CARD));
    const nestedList = li.querySelector("ul");
    expect(nestedList?.getAttribute("role")).toBe("list");
    const nested = [...(nestedList?.children ?? [])].map(textOf);
    expect(nested).toHaveLength(2);
    expect(nested[0]).toContain(statusLine(TODAY_CARD.rows[1]));
    expect(nested[1]).toContain(statusLine(TODAY_CARD.rows[2]));
    const glyphs = li.querySelectorAll("[data-medication-glyph]");
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].getAttribute("data-medication-glyph")).toBe("md");
    expect(li.querySelectorAll('[id^="due-name-"]')).toHaveLength(1);
  });

  it("marks due-now and overdue rows with their own named markers", () => {
    const li = cardItem(renderCard(TODAY_CARD));
    const labels = [...li.querySelectorAll('[role="img"]')].map((m) =>
      m.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Due now", "Overdue", "Overdue"]);
    const earlier = cardItem(renderCard(EARLIER_CARD));
    expect(earlier.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Overdue");
  });

  it("borders the card by its top row: accent when due now, amber when overdue or earlier", () => {
    expect(cardItem(renderCard(TODAY_CARD)).classList.contains("border-accent-ink/50")).toBe(true);
    expect(cardItem(renderCard(TODAY_CARD)).classList.contains("border-warning/50")).toBe(false);
    expect(cardItem(renderCard(OVERDUE_CARD)).classList.contains("border-warning/50")).toBe(true);
    expect(cardItem(renderCard(EARLIER_CARD)).classList.contains("border-warning/50")).toBe(true);
  });

  it("never fades, dashes or tints a row that needs action", () => {
    const doc = renderCard(TODAY_CARD);
    expect(doc.querySelectorAll('[class*="opacity-"], [class*="border-dashed"]')).toHaveLength(0);
  });

  it("names an Earlier row's buttons with its day", () => {
    const at = formatSlotTime(new Date("2026-04-30T22:00:00.000Z"), TODAY_START, TZ, "24h");
    expect(at).toBe("yesterday 22:00");
    const names = [...renderCard(EARLIER_CARD).querySelectorAll("button")].map(accessibleName);
    expect(names).toEqual([
      `Log now: Lisinopril 10mg, ${at} dose`,
      `Took it at ${at}: Lisinopril 10mg`,
      `Skip: Lisinopril 10mg, ${at} dose`,
    ]);
  });

  it("names every button by its visible label first, context after, never by aria-label (WCAG 2.5.3)", () => {
    for (const card of [TODAY_CARD, EARLIER_CARD]) {
      for (const button of renderCard(card).querySelectorAll("button")) {
        expect(button.hasAttribute("aria-label")).toBe(false);
        expect(button.hasAttribute("aria-labelledby")).toBe(false);
        const visible = visibleLabel(button);
        expect(visible.length).toBeGreaterThan(0);
        expect(accessibleName(button).startsWith(visible)).toBe(true);
      }
    }
  });

  it("keeps every dose control at least 44px tall, and Log now 48px × 104px", () => {
    const doc = renderCard(TODAY_CARD);
    const logNow = buttonNamed(doc, "Log now: Metformin 500mg, 13:30 dose");
    expect([...logNow.classList]).toEqual(
      expect.arrayContaining(["h-12", "min-w-26", "bg-accent"]),
    );
    const skip = buttonNamed(doc, "Skip: Metformin 500mg, 11:00 dose");
    expect([...skip.classList]).toEqual(expect.arrayContaining(["h-11", "min-w-11"]));
    const took = buttonNamed(doc, "Took it at 11:00: Metformin 500mg");
    expect([...took.classList]).toEqual(expect.arrayContaining(["h-11", "border-border-strong"]));
    for (const button of doc.querySelectorAll("button")) {
      // data-density="compact" rewrites only .p-5, .p-6 and .py-2.5 (app.css).
      expect([...button.classList]).not.toEqual(expect.arrayContaining(["p-5"]));
      expect([...button.classList]).not.toEqual(expect.arrayContaining(["p-6"]));
      expect([...button.classList]).not.toEqual(expect.arrayContaining(["py-2.5"]));
    }
  });

  it("marks every dose control aria-disabled — never disabled — while a write holds the lock", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    const buttons = [...renderCard(TODAY_CARD, lock).querySelectorAll("button")];
    expect(buttons.length).toBe(4);
    for (const button of buttons) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.hasAttribute("disabled")).toBe(false);
    }
  });

  it("passes axe: button-name, listitem, aria-required-children, aria-prohibited-attr, nested-interactive", async () => {
    const rules = [
      "button-name",
      "listitem",
      "aria-required-children",
      "aria-prohibited-attr",
      "nested-interactive",
    ];
    for (const card of [TODAY_CARD, EARLIER_CARD]) {
      const results = await runAxe(renderCard(card), rules);
      const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
      expect(offenders, offenders.join("\n")).toEqual([]);
      for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
    }
  });
});
