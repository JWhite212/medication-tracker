// @vitest-environment node
//
// "Done today": one row per dose event, the slots it covered, and the untimed
// alternatives to the toast's Undo (Edit → Remove, Remove skip). `node` is
// load-bearing — see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";
import { formatSlotTime } from "$lib/utils/dashboard-copy";
import { toneClass } from "$lib/utils/status-tone";
import type { DoneTimeDisplay } from "$lib/preferences/domains";

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
      serverNow: NOW,
      todayStart: TODAY_START,
      timezone: TZ,
      timeFormat: "24h",
      timeSinceDaysFromHours: 48,
      onedit: () => {},
    },
    context: dashboardContext({ now: NOW }),
  });
  return ssrDocument(body);
}

function renderMode(
  rows: DoneRow[],
  timeDisplay?: DoneTimeDisplay,
): { doc: Document; body: string } {
  const { body } = render(DoneList, {
    props: {
      rows,
      title: "Done today",
      serverNow: NOW,
      todayStart: TODAY_START,
      timezone: TZ,
      timeFormat: "24h",
      timeSinceDaysFromHours: 48,
      onedit: () => {},
      ...(timeDisplay === undefined ? {} : { timeDisplay }),
    },
    context: dashboardContext({ now: NOW }),
  });
  return { doc: ssrDocument(body), body };
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

  it("says an empty day in one line, with no card or list", () => {
    const section = renderList([]).querySelector("section")!;
    expect(section.querySelector(".bg-glass")).toBeNull();
    expect(section.querySelector("ul")).toBeNull();
    expect(section.querySelectorAll("p")).toHaveLength(1);
  });

  // The number this page lost when it was rebuilt, and the one History
  // shows: how long ago each dose was taken, from the page's server tick.
  it("shows how long ago a taken dose was, stacked under its clock time", () => {
    const li = items(renderList(ROWS))[3];
    const since = li.querySelector("time[data-time-since]");
    expect(since).not.toBeNull();
    expect(textOf(since!)).toBe("29m ago");
    expect(since!.getAttribute("datetime")).toBe("2026-05-01T13:31:00.000Z");
    // Same column as the clock time, after it.
    expect(since!.parentElement!.textContent!.replace(/\s+/g, " ").trim()).toBe("13:31 29m ago");
  });

  it("measures time since from serverNow, not the device clock", () => {
    const { body } = render(DoneList, {
      props: {
        rows: [ROWS[3]],
        title: "Done today",
        serverNow: new Date("2026-05-02T16:01:00.000Z"),
        todayStart: TODAY_START,
        timezone: TZ,
        timeFormat: "24h",
        timeSinceDaysFromHours: 48,
        onedit: () => {},
      },
      context: dashboardContext({ now: NOW }),
    });
    expect(textOf(ssrDocument(body).querySelector("time[data-time-since]")!)).toBe("26h 30m ago");
  });

  it.each([
    { threshold: 24, since: "1d ago" },
    { threshold: 48, since: "30h 0m ago" },
  ])(
    "words a 30-hour-old dose as $since at a $threshold-hour threshold",
    ({ threshold, since }) => {
      const { body } = render(DoneList, {
        props: {
          rows: [ROWS[3]],
          title: "Done today",
          // ROWS[3] was taken at 13:31 on 1 May: 30 hours before this.
          serverNow: new Date("2026-05-02T19:31:00.000Z"),
          todayStart: TODAY_START,
          timezone: TZ,
          timeFormat: "24h",
          timeSinceDaysFromHours: threshold,
          onedit: () => {},
        },
        context: dashboardContext({ now: NOW }),
      });
      expect(textOf(ssrDocument(body).querySelector("time[data-time-since]")!)).toBe(since);
    },
  );

  it("gives skipped, missed and yesterday's rows the right time-since treatment", () => {
    const lis = items(renderList(ROWS));
    expect(lis[1].querySelector("[data-time-since]")).toBeNull();
    expect(lis[2].querySelector("[data-time-since]")).toBeNull();
    expect(textOf(lis[0].querySelector("[data-time-since]")!)).toBe("16h 0m ago");
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

  it("gives a skipped row a neutral marker, the word, and a Remove skip that removes it", () => {
    const li = items(renderList(ROWS))[1];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Skipped");
    expect(textOf(li)).toContain("Skipped");
    // Not "Undo skip": every Undo offer has a button named Undo, and a voice
    // command of "click Undo" must not match this one as well.
    expect(textOf(li)).not.toContain("Undo");
    const form = buttonNamed(li, "Remove skip: Metformin 500mg, skipped at 11:00").closest("form")!;
    expect(form.getAttribute("action")).toBe("?/deleteDose");
    expect(hiddenFields(form)).toEqual({ doseId: "d2" });
  });

  it("renders a missed row with Missed and a Remove", () => {
    const li = items(renderList(ROWS))[2];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Missed");
    expect(textOf(li)).toContain("Missed");
    const form = buttonNamed(li, "Remove: Metformin 500mg, missed at 12:00").closest("form")!;
    expect(hiddenFields(form)).toEqual({ doseId: "d3" });
  });

  // A phone screenshot: on one line beside a worded "Remove skip" the name
  // was squeezed to nothing and "5000IU Skipped" ran over the button.
  it("gives the name its own line below sm, with the dose and status word under it", () => {
    const li = items(renderList(ROWS))[1];
    const line = li.querySelector("div > p")!;
    expect([...line.classList]).toEqual(expect.arrayContaining(["flex-col", "sm:flex-row"]));
    const [name, details] = [...line.children];
    expect(textOf(name)).toBe("Metformin");
    expect(name.classList.contains("truncate")).toBe(true);
    // The dose and the word travel together, and wrap rather than truncate.
    expect(textOf(details)).toBe("500mg Skipped");
    expect([...details.classList]).toEqual(expect.arrayContaining(["flex-wrap", "sm:flex-nowrap"]));
  });

  it("shows a skip or missed row's Remove as × below sm, keeping its words for assistive tech", () => {
    const doc = renderList(ROWS);
    for (const [index, name] of [
      [1, "Remove skip: Metformin 500mg, skipped at 11:00"],
      [2, "Remove: Metformin 500mg, missed at 12:00"],
    ] as const) {
      const button = buttonNamed(items(doc)[index], name);
      const glyph = button.querySelector('[aria-hidden="true"].sm\\:hidden')!;
      expect(textOf(glyph)).toBe("×");
      const label = button.querySelector('[data-part="label"] > .max-sm\\:sr-only')!;
      expect(label.textContent).toBe(name);
      // The pending label shares the button's width cell, so it must shrink too.
      const pending = button.querySelector('[data-part="pending"] > .max-sm\\:sr-only')!;
      expect(textOf(pending)).toBe("Removing…");
    }
    // A taken row's Edit keeps its word at every width.
    expect(doc.querySelector("[data-edit] .max-sm\\:sr-only")).toBeNull();
  });

  it("marks every row with its dose id, and only a taken row's Edit with data-edit", () => {
    // What an Undo's focus target reads once the restore's reload has
    // re-rendered the row: the row by its id, then its Edit.
    const doc = renderList(ROWS);
    expect(items(doc).map((li) => li.getAttribute("data-dose-id"))).toEqual([
      "d0",
      "d2",
      "d3",
      "d1",
    ]);
    const edits = [...doc.querySelectorAll<HTMLElement>("[data-edit]")];
    expect(edits.map((el) => el.closest("li")?.getAttribute("data-dose-id"))).toEqual(["d0", "d1"]);
    for (const edit of edits) expect(visibleLabel(edit)).toBe("Edit");
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

  /** The status word beside the dose text ("Skipped" or "Missed"). */
  const statusWord = (li: Element, word: string) =>
    [...li.querySelectorAll("p span")].find((s) => textOf(s) === word)!;

  it("draws a missed row red: the wrong-tone marker and the word Missed", () => {
    const li = items(renderList(ROWS))[2];
    const marker = li.querySelector('[role="img"]')!;
    expect([...marker.classList]).toEqual(
      expect.arrayContaining(toneClass("wrong", "marker").split(" ")),
    );
    expect([...statusWord(li, "Missed").classList]).toEqual(
      expect.arrayContaining(toneClass("wrong", "text").split(" ")),
    );
  });

  it("keeps a skipped row's word neutral, so skipped and missed no longer look alike", () => {
    const word = statusWord(items(renderList(ROWS))[1], "Skipped");
    expect([...word.classList]).toEqual(
      expect.arrayContaining(toneClass("neutral", "text").split(" ")),
    );
    expect(word.className).not.toMatch(/danger/);
  });

  it("passes axe: button-name, listitem, aria-required-children, aria-prohibited-attr", async () => {
    const rules = ["button-name", "listitem", "aria-required-children", "aria-prohibited-attr"];
    const results = await runAxe(renderList(ROWS), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });

  describe("timeDisplay", () => {
    it("renders the same markup with no prop as with 'both'", () => {
      expect(renderMode(ROWS).body).toBe(renderMode(ROWS, "both").body);
    });

    it("'since' makes the since text the primary line, with the clock for assistive tech and the tooltip", () => {
      const li = items(renderMode(ROWS, "since").doc)[3];
      const since = li.querySelector("time[data-time-since]")!;
      expect(since.getAttribute("datetime")).toBe("2026-05-01T13:31:00.000Z");
      expect(since.getAttribute("title")).toBe("13:31");
      expect([...since.classList]).toEqual(
        expect.arrayContaining(["block", "text-sm", "text-text-primary"]),
      );
      expect(since.textContent).toBe("29m ago at 13:31");
      const hidden = since.querySelector(".sr-only")!;
      expect(hidden.textContent).toBe(" at 13:31");
      // The visible clock is gone: the column holds only the <time>.
      const column = since.parentElement!;
      expect(column.querySelectorAll(":scope > span.block")).toHaveLength(0);
      expect(column.classList.contains("min-w-24")).toBe(true);
      expect(column.classList.contains("min-w-20")).toBe(false);
    });

    it("'since' keeps the Yesterday line above", () => {
      const li = items(renderMode(ROWS, "since").doc)[0];
      expect(textOf(li.querySelector("span.text-xs")!)).toBe("Yesterday");
      expect(li.querySelector("time[data-time-since]")).not.toBeNull();
    });

    it("'clock' renders no since element, and 'both' keeps min-w-20", () => {
      const doc = renderMode(ROWS, "clock").doc;
      expect(doc.querySelector("[data-time-since]")).toBeNull();
      expect(textOf(items(doc)[3])).toContain("13:31");
      expect(items(renderMode(ROWS, "both").doc)[3].querySelector(".min-w-20")).not.toBeNull();
    });

    it.each(["both", "since", "clock"] as const)(
      "%s: skipped and missed rows show their clock and no since",
      (mode) => {
        const lis = items(renderMode(ROWS, mode).doc);
        for (const [i, clock] of [
          [1, "11:00"],
          [2, "12:00"],
        ] as const) {
          expect(lis[i].querySelector("[data-time-since]")).toBeNull();
          expect(textOf(lis[i].querySelector("span.tabular-nums")!)).toBe(clock);
        }
      },
    );

    it.each(["both", "since", "clock"] as const)(
      "%s: two doses minutes apart stay two rows",
      (mode) => {
        const a: DoneRow = {
          key: "a",
          dose: dose({ id: "a", takenAt: new Date("2026-05-01T08:55:00.000Z") }),
          covers: [],
          dayLabel: null,
        };
        const b: DoneRow = {
          key: "b",
          dose: dose({ id: "b", takenAt: new Date("2026-05-01T09:00:00.000Z") }),
          covers: [],
          dayLabel: null,
        };
        expect(items(renderMode([a, b], mode).doc)).toHaveLength(2);
      },
    );
  });
});
