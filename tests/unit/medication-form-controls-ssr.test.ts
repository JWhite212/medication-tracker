// @vitest-environment node
//
// The controls of the medication form and the dose editor: which primitive
// draws each one, what the assistive-tech name of each is, and that the form's
// notice says it needs you without interrupting. Server-rendered markup is
// what a not-yet-hydrated page shows, and `node` is load-bearing: see
// tests/unit/error-page-ssr.test.ts.
//
// Does NOT cover: what a press does (form-errors-enhance-callbacks.test.ts and
// accessible-pickers-focus.svelte.test.ts mount the components), or the
// contrast of any colour here (theme-tokens.test.ts, which reads TONE_CLASSES).
import { describe, it, expect, vi } from "vitest";
import type { ComponentProps } from "svelte";
import { render } from "svelte/server";

// MedicationForm's use:enhance is SvelteKit client runtime, unreachable on the
// server and not what this asserts.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

import MedicationForm from "../../src/lib/components/MedicationForm.svelte";
import InteractionWarningPanel from "../../src/lib/components/medication-form/InteractionWarningPanel.svelte";
import ScheduleSection from "../../src/lib/components/medication-form/MedicationScheduleSection.svelte";
import StylePicker from "../../src/lib/components/medication-form/MedicationStylePicker.svelte";
import { toneClass, type Tone } from "$lib/utils/status-tone";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { expectAxeClean, ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const FOCUS_RING = "focus-visible:outline-accent-ink";
const classes = (el: Element | null | undefined) => [...(el?.classList ?? [])];
const toneTokens = (tone: Tone) => toneClass(tone, "alert").split(" ");

/** A button's name as assistive tech gets it: its text without hidden or invisible parts. */
function spokenName(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"], .invisible').forEach((n) => n.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}
const spoken = (el: Element) => el.getAttribute("aria-label") ?? spokenName(el);

describe("MedicationForm's submit", () => {
  const form = (props: ComponentProps<typeof MedicationForm> = {}) =>
    ssrDocument(render(MedicationForm, { props }).body);

  it.each([
    [{}, "Add Medication"],
    [{ medication: { ...BASE_MEDICATION_ROW, lowInventoryEpisodeAt: null } }, "Update Medication"],
  ] as const)("is a full-width 44px primary Button named %#", (props, name) => {
    const submits = form(props).querySelectorAll('form button[type="submit"]');
    expect(submits).toHaveLength(1);
    expect(spoken(submits[0])).toBe(name);
    expect(classes(submits[0])).toEqual(
      expect.arrayContaining(["bg-accent", "text-accent-fg", "w-full", "h-11", FOCUS_RING]),
    );
    expect(submits[0].hasAttribute("disabled")).toBe(false);
  });

  it("gives every other control in the form an explicit type=button, so no picker submits it", () => {
    const doc = form({ formValues: { scheduleMode: "fixed_time", colourSecondary: "#f59e0b" } });
    const buttons = [...doc.querySelectorAll("form button")];
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons)
      expect(["button", "submit"], b.outerHTML).toContain(b.getAttribute("type"));
    expect(buttons.filter((b) => b.getAttribute("type") === "submit")).toHaveLength(1);
  });
});

describe("InteractionWarningPanel", () => {
  const panel = (warnings: string[]) =>
    ssrDocument(render(InteractionWarningPanel, { props: { warnings } }).body);

  it("says it needs you without interrupting: a needs-you Alert in a status region, never role=alert", () => {
    const doc = panel(["Aspirin may increase bleeding risk."]);
    expect(doc.querySelector('[role="alert"]')).toBeNull();
    const region = doc.querySelector('[role="status"]')!;
    expect(classes(region.firstElementChild)).toEqual(
      expect.arrayContaining(toneTokens("needs-you")),
    );
    expect(textOf(region)).toContain("Experimental interaction notice");
    expect(textOf(region)).toContain("Aspirin may increase bleeding risk.");
    expect(textOf(region)).toContain(
      "This check may miss interactions and may produce false positives.",
    );
  });

  it("keeps its status region mounted, and empty, while there is nothing to say", () => {
    const region = panel([]).querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(textOf(region!)).toBe("");
  });
});

describe("MedicationScheduleSection's controls", () => {
  const schedule = (p: Partial<ComponentProps<typeof ScheduleSection>> = {}) =>
    ssrDocument(
      render(ScheduleSection, {
        props: {
          mode: "fixed_time",
          intervalHours: "",
          fixedTimes: ["08:00"],
          daysOfWeek: [],
          errors: {},
          ...p,
        },
      }).body,
    );
  const MODE_GROUP = '[role="group"][aria-label="Schedule"]';

  it("offers the three modes as Toggles, only the current one pressed", () => {
    const modes = [...schedule().querySelectorAll(`${MODE_GROUP} button`)];
    expect(modes.map(spoken)).toEqual(["Interval", "Fixed time", "As needed (PRN)"]);
    expect(modes.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    for (const b of modes) {
      expect(b.getAttribute("type")).toBe("button");
      expect(classes(b)).toEqual(expect.arrayContaining(["h-9", FOCUS_RING]));
    }
    expect(classes(modes[1])).toEqual(
      expect.arrayContaining(["border-accent-ink", "bg-accent/15", "text-accent-ink"]),
    );
    for (const b of [modes[0], modes[2]]) {
      expect(classes(b)).toContain("border-border-strong");
      expect(classes(b)).not.toContain("border-glass-border");
    }
  });

  it("offers the seven days as Toggles, pressed from daysOfWeek", () => {
    const days = [
      ...schedule({ daysOfWeek: [1, 3, 5] }).querySelectorAll("button[aria-pressed]"),
    ].filter((b) => !b.closest(MODE_GROUP));
    expect(days.map(spoken)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days.filter((b) => b.getAttribute("aria-pressed") === "true").map(spoken)).toEqual([
      "Mon",
      "Wed",
      "Fri",
    ]);
    for (const b of days) expect(classes(b)).toContain("h-9");
  });

  it("removes a time with a neutral secondary Button, disabled only while one row is left", () => {
    const removes = (doc: Document) => [
      ...doc.querySelectorAll('button[aria-label="Remove this time"]'),
    ];
    expect(removes(schedule()).map((b) => b.hasAttribute("disabled"))).toEqual([true]);
    const two = removes(schedule({ fixedTimes: ["08:00", "20:00"] }));
    expect(two.map((b) => b.hasAttribute("disabled"))).toEqual([false, false]);
    for (const b of two) {
      expect(b.getAttribute("type")).toBe("button");
      expect(classes(b)).toEqual(
        expect.arrayContaining(["border-border-strong", "h-9", FOCUS_RING]),
      );
      expect(b.className).not.toMatch(/danger/);
    }
  });

  it("adds a time with a secondary sm Button", () => {
    const add = [...schedule().querySelectorAll("button")].find((b) => spoken(b) === "+ Add time")!;
    expect(add.getAttribute("type")).toBe("button");
    expect(classes(add)).toEqual(
      expect.arrayContaining(["border-border-strong", "h-9", FOCUS_RING]),
    );
  });
});

describe("MedicationStylePicker's add and remove buttons", () => {
  const picker = (secondary: string | null) =>
    ssrDocument(
      render(StylePicker, {
        props: {
          selectedColour: "#6366f1",
          selectedColourSecondary: secondary,
          selectedPattern: secondary ? "stripes" : "solid",
          errors: {},
        },
      }).body,
    );

  it.each([
    ["Add secondary colour", null],
    ["Remove secondary colour", "#f59e0b"],
  ] as const)(
    "draws the %s button as a 36px IconButton with a hidden glyph",
    (label, secondary) => {
      const b = picker(secondary).querySelector(`button[aria-label="${label}"]`)!;
      expect(b.getAttribute("type")).toBe("button");
      expect(classes(b)).toEqual(
        expect.arrayContaining(["size-9", "border-border-strong", FOCUS_RING]),
      );
      expect(b.querySelector('[aria-hidden="true"]')).not.toBeNull();
    },
  );

  it("draws Remove secondary colour neutrally, because removing a colour can be undone", () => {
    const remove = picker("#f59e0b").querySelector('button[aria-label="Remove secondary colour"]')!;
    expect(remove.className).not.toMatch(/danger/);
  });
});

describe("the medication form's markup passes axe", () => {
  it("names every button and allows every aria attribute, with the notice showing", async () => {
    await expectAxeClean(
      ssrDocument(
        render(MedicationForm, {
          props: {
            errors: { colour: ["Choose a colour"] },
            formValues: { scheduleMode: "fixed_time" },
          },
        }).body +
          render(InteractionWarningPanel, {
            props: { warnings: ["Aspirin may increase bleeding risk."] },
          }).body,
      ),
      ["button-name", "aria-allowed-attr", "aria-valid-attr-value"],
    );
  });
});
