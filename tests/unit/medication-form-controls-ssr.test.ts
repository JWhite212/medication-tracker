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
