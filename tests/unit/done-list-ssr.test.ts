// @vitest-environment node
//
// "Done today": one row per dose event, the slots it covered, and the untimed
// alternatives to the toast's Undo (Edit → Remove, Undo skip). `node` is
// load-bearing — see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";
import { formatSlotTime } from "$lib/utils/dashboard-copy";

vi.mock("$app/forms", () => ({
  enhance: () => ({ destroy() {} }),
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DoneList from "$lib/components/dashboard/DoneList.svelte";
import { DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";
import { dashboardContext } from "./helpers/dashboard-context";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import {
  accessibleName,
  buttonNamed,
  hiddenFields,
  textOf,
  visibleLabel,
} from "./helpers/dom-names";

const NOW = new Date("2026-05-01T14:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const TZ = "UTC";

function dose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  const takenAt = overrides.takenAt ?? new Date("2026-05-01T13:31:00.000Z");
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt,
    loggedAt: takenAt,
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: takenAt,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

const BACKDATED: DoneRow = {
  key: "d0",
  dose: dose({
    id: "d0",
    takenAt: new Date("2026-04-30T22:00:00.000Z"),
    loggedAt: new Date("2026-05-01T07:00:00.000Z"),
  }),
  covers: [],
  dayLabel: "yesterday",
};
const SKIPPED: DoneRow = {
  key: "d2",
  dose: dose({ id: "d2", status: "skipped", takenAt: new Date("2026-05-01T11:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};
const MISSED: DoneRow = {
  key: "d3",
  dose: dose({ id: "d3", status: "missed", takenAt: new Date("2026-05-01T12:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};
const TAKEN: DoneRow = {
  key: "d1",
  dose: dose({ id: "d1", quantity: 4 }),
  covers: ["2026-04-30T22:30:00.000Z", "2026-05-01T08:55:00.000Z", "2026-05-01T09:00:00.000Z"],
  dayLabel: null,
};
const ROWS = [BACKDATED, SKIPPED, MISSED, TAKEN];

function renderList(rows: DoneRow[], title = "Done today"): Document {
  const { body } = render(DoneList, {
    props: {
      rows,
      title,
      todayStart: TODAY_START,
      timezone: TZ,
      timeFormat: "24h",
      onedit: () => {},
    },
    context: dashboardContext({ now: NOW }),
  });
  return ssrDocument(body);
}

const items = (doc: Document) => [...doc.querySelectorAll<HTMLLIElement>("section ul > li")];

describe("DoneList", () => {
  it("always renders its heading as a focus target, even when nothing is logged", () => {
    const doc = renderList([]);
    const section = doc.querySelector("section");
    const h2 = doc.getElementById(DONE_HEADING_ID);
    expect(section?.getAttribute("aria-labelledby")).toBe(DONE_HEADING_ID);
    expect(h2?.tagName).toBe("H2");
    expect(h2?.getAttribute("tabindex")).toBe("-1");
    expect(textOf(h2!)).toBe("Done today");
    expect(textOf(section!)).toContain("Nothing logged yet today");
  });

  it("uses the title it is given", () => {
    expect(textOf(renderList([], "Logged today").getElementById(DONE_HEADING_ID)!)).toBe(
      "Logged today",
    );
  });

  it("lists rows in the order given, each at least 44px tall", () => {
    const lis = items(renderList(ROWS));
    expect(lis).toHaveLength(4);
    for (const li of lis) expect(li.classList.contains("min-h-11")).toBe(true);
    expect(textOf(lis[3])).toContain("13:31");
  });

  it("shows a taken dose's time, marker, glyph, name, dose and quantity", () => {
    const li = items(renderList(ROWS))[3];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Taken");
    expect(li.querySelector("[data-medication-glyph]")?.getAttribute("data-medication-glyph")).toBe(
      "sm",
    );
    expect(textOf(li)).toContain("Metformin");
    expect(textOf(li)).toContain("500mg ×4");
  });

  it("states which slots a dose covered, with yesterday's prefixed", () => {
    const li = items(renderList(ROWS))[3];
    const covered = TAKEN.covers.map((c) => formatSlotTime(new Date(c), TODAY_START, TZ, "24h"));
    expect(covered[0]).toBe("yesterday 22:30");
    expect(textOf(li)).toContain(`for ${covered.join(", ")}`);
  });

  it("omits the covers line when a dose covered nothing", () => {
    expect(textOf(items(renderList(ROWS))[0])).not.toContain("for ");
  });

  it("shows a backdated Took it at as Yesterday, so it can be seen and undone", () => {
    const li = items(renderList(ROWS))[0];
    expect(textOf(li)).toContain("Yesterday");
    expect(textOf(li)).toContain("22:00");
    buttonNamed(li, "Edit: Metformin 500mg dose taken at yesterday 22:00");
  });

  it("gives a taken row an Edit button — outside any form — that says which dose", () => {
    const edit = buttonNamed(renderList(ROWS), "Edit: Metformin 500mg dose taken at 13:31");
    expect(edit.getAttribute("type")).toBe("button");
    expect(edit.closest("form")).toBeNull();
    expect([...edit.classList]).toEqual(expect.arrayContaining(["h-11", "border-border-strong"]));
  });

  it("gives a skipped row a neutral marker, the word, and an Undo skip that removes it", () => {
    const li = items(renderList(ROWS))[1];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Skipped");
    expect(textOf(li)).toContain("Skipped");
    const form = buttonNamed(li, "Undo skip: Metformin 500mg, skipped at 11:00").closest("form")!;
    expect(form.getAttribute("action")).toBe("?/deleteDose");
    expect(hiddenFields(form)).toEqual({ doseId: "d2" });
  });

  it("renders a missed row the same way, with Missed", () => {
    const li = items(renderList(ROWS))[2];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Missed");
    expect(textOf(li)).toContain("Missed");
    const form = buttonNamed(li, "Remove: Metformin 500mg, missed at 12:00").closest("form")!;
    expect(hiddenFields(form)).toEqual({ doseId: "d3" });
  });

  it("has no hover-revealed controls", () => {
    expect(
      renderList(ROWS).querySelectorAll('[class*="opacity-0"], [class*="group-hover"]'),
    ).toHaveLength(0);
  });

  it("names every button by its visible label first, never by aria-label", () => {
    for (const button of renderList(ROWS).querySelectorAll("button")) {
      expect(button.hasAttribute("aria-label")).toBe(false);
      expect(accessibleName(button).startsWith(visibleLabel(button))).toBe(true);
    }
  });

  it("passes axe: button-name, listitem, aria-required-children, aria-prohibited-attr", async () => {
    const rules = ["button-name", "listitem", "aria-required-children", "aria-prohibited-attr"];
    const results = await runAxe(renderList(ROWS), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});
