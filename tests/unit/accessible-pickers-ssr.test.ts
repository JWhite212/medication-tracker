// @vitest-environment node
//
// Covers: the SSR'd markup of the medication style picker and the dose
// side-effect picker. Radio grouping, legends, labels, accessible names and
// the `checked` attribute are all plain DOM, so they are as true of the
// server's HTML as of a browser, and the server's HTML is what a no-JS or
// not-yet-hydrated page actually shows.
//
// Does NOT cover: arrow-key movement inside a radio group (native browser
// behaviour, which jsdom does not implement), what a click does after
// hydration, or where focus goes when a control removes itself; those are in
// accessible-pickers-focus.svelte.test.ts, which mounts the components. Nor
// how the check mark and the focus ring look (CSS). The class assertions
// below pin which STATE drives each cue, not the pixels.
//
// `@vitest-environment node` is load-bearing: the suite's default is jsdom,
// and under jsdom vite resolves `svelte` to its client entry, so `render()`
// from `svelte/server` throws `effect_orphan` before an assertion runs. The
// markup is parsed with jsdom directly instead, which is a parser here, not
// an environment.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import { JSDOM } from "jsdom";
import MedicationStylePicker from "../../src/lib/components/medication-form/MedicationStylePicker.svelte";
import SideEffectPicker from "../../src/lib/components/SideEffectPicker.svelte";
import MedicationForm from "../../src/lib/components/MedicationForm.svelte";
import { PRESET_COLOURS } from "$lib/medications/medication-style-options";
import { CUSTOM_COLOUR_NAME, PRESET_COLOUR_NAMES } from "$lib/medications/medication-colour-names";
import { PATTERN_OPTIONS } from "$lib/utils/medication-style";
import type { SideEffect } from "$lib/types";

// MedicationForm's `use:enhance` is SvelteKit client runtime, unreachable on
// the server and not what these assertions are about.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

function parse(html: string): Document {
  return new JSDOM(`<!doctype html><html lang="en"><body>${html}</body></html>`).window.document;
}

function renderStylePicker(props: {
  colour: string;
  secondary?: string | null;
  pattern?: string;
}): Document {
  return parse(
    render(MedicationStylePicker, {
      props: {
        selectedColour: props.colour,
        selectedColourSecondary: props.secondary ?? null,
        selectedPattern: props.pattern ?? "solid",
        errors: {},
      },
    }).body,
  );
}

function renderSideEffects(value: SideEffect[]): Document {
  return parse(render(SideEffectPicker, { props: { value, onchange: () => {} } }).body);
}

function radios(doc: Document, name: string): HTMLInputElement[] {
  return [...doc.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)];
}

/** What a screen reader announces for a radio: its wrapping label's text. */
function nameOf(input: HTMLInputElement): string {
  const labels = input.labels ?? [];
  expect(labels.length, `radio ${input.value} has no label`).toBe(1);
  return (labels[0].textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Text as a screen reader gets it: without anything marked aria-hidden. */
function spokenText(el: Element | null | undefined): string {
  if (!el) return "";
  const copy = el.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The name of the group a control sits in: its nearest fieldset's own legend. */
function groupOf(el: Element): string {
  return spokenText(el.closest("fieldset")?.querySelector(":scope > legend"));
}

/** What a legend shows beyond its spoken name: the chosen option, in words. */
function shownChoice(radio: Element): string {
  const legend = radio.closest("fieldset")!.querySelector(":scope > legend")!;
  return (legend.querySelector('[aria-hidden="true"]')?.textContent ?? "").trim();
}

describe("MedicationStylePicker: primary colour group", () => {
  const doc = renderStylePicker({ colour: "#14b8a6" });
  const primary = radios(doc, "colour");

  it("is one native radio per preset, inside a fieldset named by its legend", () => {
    // Each swatch was a bare button with no role state: "Select primary
    // colour #14b8a6, button" whether or not it was the chosen one.
    expect(primary.map((r) => r.value)).toEqual([...PRESET_COLOURS]);
    for (const radio of primary) expect(groupOf(radio)).toBe("Primary colour");
    // No secondary colour, so neither of the groups that depend on one.
    expect(radios(doc, "colourSecondary")).toHaveLength(0);
    expect(radios(doc, "pattern")).toHaveLength(0);
  });

  it("checks the stored colour, and only that one", () => {
    expect(primary.filter((r) => r.checked).map((r) => r.value)).toEqual(["#14b8a6"]);
  });

  it("shows the chosen colour's name in a visible legend, outside the group's spoken name", () => {
    // The names were reachable only through a hover tooltip, so a touch or
    // keyboard user still had no word for the swatch they had chosen. The
    // checked radio already says it, so the legend's copy is aria-hidden
    // rather than repeated in the group name.
    const legend = primary[0].closest("fieldset")!.querySelector(":scope > legend")!;
    expect(legend.classList.contains("sr-only")).toBe(false);
    expect(shownChoice(primary[0])).toBe(": Teal");
  });

  it("keeps 'Add secondary colour' out of the Primary colour group", () => {
    // Inside it, the button was announced as a member of "Primary colour".
    const add = doc.querySelector('button[aria-label="Add secondary colour"]');
    expect(add, "no Add secondary colour button").not.toBeNull();
    expect(groupOf(add!)).not.toBe("Primary colour");
    expect(add!.closest("fieldset")?.getAttribute("aria-labelledby")).toBe("stylePickerLegend");
  });

  it("names every swatch in words, never by its hex code", () => {
    for (const radio of primary) {
      expect(nameOf(radio)).toBe(
        PRESET_COLOUR_NAMES[radio.value as keyof typeof PRESET_COLOUR_NAMES],
      );
    }
    expect(nameOf(primary.find((r) => r.checked)!)).toBe("Teal");
    expect(doc.body.innerHTML).not.toMatch(/Select (primary|secondary) colour #/);
  });

  it("keeps the radios focusable: visually hidden, not hidden", () => {
    expect(primary.length).toBeGreaterThan(0);
    for (const radio of primary) {
      expect(radio.classList.contains("sr-only")).toBe(true);
      expect(radio.hidden).toBe(false);
      expect(radio.disabled).toBe(false);
      expect(radio.getAttribute("tabindex")).toBeNull();
    }
  });

  it("marks selection with a check driven by :checked, and focus with a separate ring", () => {
    // The selected state used to be `ring-accent-ink ring-2 ring-offset-2`,
    // added by component state: byte-for-byte the focus ring. Now every
    // swatch's markup is identical whether or not it is chosen, so the cue
    // can only come from `:checked` (right before hydration, too), and no
    // `peer-checked:` class touches the ring focus uses.
    const faces = primary.map((r) => r.nextElementSibling!.className);
    expect(new Set(faces).size).toBe(1);
    expect(faces[0]).toContain("peer-focus-visible:ring-2");
    expect(faces[0]).not.toMatch(/(^|\s)(focus:)?ring-/);
    // Forced colours drops box-shadow, and with it the ring. A transparent
    // outline is invisible otherwise and is repainted in a system colour there.
    expect(faces[0]).toContain("peer-focus-visible:outline-transparent");
    expect(faces[0]).toContain("peer-focus-visible:outline-2");
    for (const radio of primary) {
      const label = radio.labels![0];
      const peerChecked = [...label.querySelectorAll("[class]")].flatMap((el) =>
        [...el.classList].filter((c) => c.startsWith("peer-checked:")),
      );
      expect(peerChecked.some((c) => c.includes("ring"))).toBe(false);
      const mark = label.querySelector('[aria-hidden="true"] svg');
      expect(mark, `no check mark for ${radio.value}`).not.toBeNull();
      expect(mark!.parentElement!.classList.contains("peer-checked:flex")).toBe(true);
      expect(mark!.parentElement!.classList.contains("hidden")).toBe(true);
    }
  });
});

describe("MedicationStylePicker: secondary colour and pattern groups", () => {
  const doc = renderStylePicker({ colour: "#6366f1", secondary: "#f59e0b", pattern: "stripes" });

  it("gives the secondary colour its own named group, checked on the stored value", () => {
    const secondary = radios(doc, "colourSecondary");
    expect(secondary.map((r) => r.value)).toEqual([...PRESET_COLOURS]);
    for (const radio of secondary) expect(groupOf(radio)).toBe("Secondary colour");
    const checked = secondary.filter((r) => r.checked);
    expect(checked.map((r) => r.value)).toEqual(["#f59e0b"]);
    expect(nameOf(checked[0])).toBe("Amber");
  });

  it("gives the patterns a named group, checked on the stored pattern", () => {
    const patterns = radios(doc, "pattern");
    expect(patterns.map((r) => r.value)).toEqual(PATTERN_OPTIONS.map((p) => p.id));
    for (const radio of patterns) expect(groupOf(radio)).toBe("Pattern");
    expect(patterns.map(nameOf)).toEqual(PATTERN_OPTIONS.map((p) => p.name));
    expect(patterns.filter((r) => r.checked).map((r) => r.value)).toEqual(["stripes"]);
    for (const radio of patterns) {
      const face = radio.nextElementSibling!.className;
      expect(face).toContain("peer-focus-visible:ring-2");
      expect(face).toContain("peer-focus-visible:outline-transparent");
    }
  });

  it("shows each chosen option's name in its visible legend", () => {
    expect(shownChoice(radios(doc, "colour")[0])).toBe(": Indigo");
    expect(shownChoice(radios(doc, "colourSecondary")[0])).toBe(": Amber");
    expect(shownChoice(radios(doc, "pattern")[0])).toBe(": Diagonal Stripes");
  });

  it("keeps the two colour groups apart: choosing a secondary never unchecks the primary", () => {
    // Radios group by name within a form, so a shared name would make the
    // sixteen primaries and sixteen secondaries one group of thirty-two.
    expect(
      radios(doc, "colour")
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["#6366f1"]);
  });

  it("posts nothing MedicationForm does not already post", () => {
    // The picker sits inside MedicationForm's <form>, beside the hidden inputs
    // that carry colour, colourSecondary and pattern. A radio under any other
    // name would add a field to every create and update.
    const named = [...doc.querySelectorAll("input[name], select[name], textarea[name]")];
    expect(new Set(named.map((el) => el.getAttribute("name")))).toEqual(
      new Set(["colour", "colourSecondary", "pattern"]),
    );
    for (const radio of [...radios(doc, "colour"), ...radios(doc, "colourSecondary")]) {
      expect(radio.value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("MedicationStylePicker: a stored colour outside the presets", () => {
  it("offers it as a checked radio named as the custom colour", () => {
    // The API and import doors accept any hex. Without its own radio the
    // group has nothing checked and no way back to the stored colour.
    const doc = renderStylePicker({ colour: "#123456", secondary: "#abcdef", pattern: "split" });
    for (const name of ["colour", "colourSecondary"]) {
      const group = radios(doc, name);
      expect(group).toHaveLength(PRESET_COLOURS.length + 1);
      const checked = group.filter((r) => r.checked);
      expect(checked).toHaveLength(1);
      expect(nameOf(checked[0])).toBe(CUSTOM_COLOUR_NAME);
    }
    expect(radios(doc, "colour").find((r) => r.checked)!.value).toBe("#123456");
    expect(radios(doc, "colourSecondary").find((r) => r.checked)!.value).toBe("#abcdef");
  });

  it("offers no custom radio when the stored colour is a preset", () => {
    const doc = renderStylePicker({ colour: "#6366f1" });
    expect(radios(doc, "colour")).toHaveLength(PRESET_COLOURS.length);
    expect(radios(doc, "colour").map(nameOf)).not.toContain(CUSTOM_COLOUR_NAME);
  });

  it("does not mistake the empty secondary a failed submit echoes back for a colour", () => {
    // MedicationForm posts colourSecondary as "" when there is none, and hands
    // the echoed value back in on a validation failure. That used to open the
    // secondary and pattern groups with no secondary chosen at all.
    const doc = renderStylePicker({ colour: "#6366f1", secondary: "" });
    expect(radios(doc, "colourSecondary")).toHaveLength(0);
    expect(radios(doc, "pattern")).toHaveLength(0);
    expect(doc.querySelector('button[aria-label="Add secondary colour"]')).not.toBeNull();
  });

  it("names a preset stored in upper case after the preset it matches, not as a stranger", () => {
    // The API and import doors accept "#6366F1". `bind:group` compares
    // exactly, so it is still its own radio, but a sighted user sees two
    // indigo swatches and should not read the checked one as "Custom colour".
    const doc = renderStylePicker({ colour: "#6366F1" });
    const checked = radios(doc, "colour").filter((r) => r.checked);
    expect(checked.map((r) => r.value)).toEqual(["#6366F1"]);
    expect(nameOf(checked[0])).toBe("Indigo (custom)");
    expect(shownChoice(checked[0])).toBe(": Indigo (custom)");
  });
});

describe("MedicationStylePicker inside MedicationForm", () => {
  // The radios share their names with MedicationForm's hidden colour,
  // colourSecondary and pattern inputs, so a submit carries each of those
  // twice. That is harmless only while every copy agrees; if they disagreed,
  // the saved colour would depend on DOM order. `new FormData(form)` is
  // exactly what the browser builds on submit.
  function posted(formValues: Record<string, string>): {
    all: Record<string, string[]>;
    action: Record<string, FormDataEntryValue>;
  } {
    const doc = parse(render(MedicationForm, { props: { formValues } }).body);
    const form = doc.querySelector("form")!;
    const data = new doc.defaultView!.FormData(form);
    const all: Record<string, string[]> = {};
    for (const key of ["colour", "colourSecondary", "pattern"]) {
      all[key] = data.getAll(key).map(String);
    }
    // What the action reads: `Object.fromEntries(await request.formData())`.
    return { all, action: Object.fromEntries(data) };
  }

  const cases: Array<[string, Record<string, string>, Record<string, string>]> = [
    ["the defaults", {}, { colour: "#6366f1", colourSecondary: "", pattern: "solid" }],
    [
      "a preset primary",
      { colour: "#14b8a6" },
      { colour: "#14b8a6", colourSecondary: "", pattern: "solid" },
    ],
    [
      "a secondary colour and pattern",
      { colour: "#6366f1", colourSecondary: "#f59e0b", pattern: "dots" },
      { colour: "#6366f1", colourSecondary: "#f59e0b", pattern: "dots" },
    ],
    [
      "a custom primary",
      { colour: "#123456" },
      { colour: "#123456", colourSecondary: "", pattern: "solid" },
    ],
  ];

  it.each(cases)(
    "posts %s unchanged, with every copy of a field agreeing",
    (_, formValues, expected) => {
      const { all, action } = posted(formValues);
      for (const [key, value] of Object.entries(expected)) {
        expect(new Set(all[key]), `${key} posted ${JSON.stringify(all[key])}`).toEqual(
          new Set([value]),
        );
        expect(action[key]).toBe(value);
      }
    },
  );

  it("actually posts a radio, so the agreement above is not vacuous", () => {
    expect(posted({ colour: "#14b8a6" }).all.colour).toEqual(["#14b8a6", "#14b8a6"]);
  });

  it("posts an echoed empty secondary once, from the hidden inputs alone", () => {
    // No secondary means no secondary or pattern radios, so nothing but the
    // hidden inputs can post those two fields.
    expect(posted({ colourSecondary: "" }).all).toEqual({
      colour: ["#6366f1", "#6366f1"],
      colourSecondary: [""],
      pattern: ["solid"],
    });
  });
});

describe("SideEffectPicker", () => {
  const doc = renderSideEffects([
    { name: "Nausea", severity: "mild" },
    { name: "Rash", severity: "moderate" },
  ]);

  it("is a fieldset whose legend names the group every control sits in", () => {
    // The old heading was a <span>, and nothing tied the controls to it.
    expect(doc.querySelectorAll("fieldset")).toHaveLength(1);
    for (const control of doc.querySelectorAll("button, input")) {
      expect(groupOf(control), control.outerHTML).toBe("Side Effects");
    }
  });

  it("labels the custom effect field with more than a placeholder", () => {
    const input = doc.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(input.id).not.toBe("");
    expect(input.labels).toHaveLength(1);
    expect(input.labels![0].textContent!.trim()).toBe("Other side effect");
  });

  it("names a custom chip by what pressing it does, and leaves the common chips as toggles", () => {
    const chip = doc.querySelector('button[aria-label="Remove Rash"]');
    expect(chip, "no Remove Rash button").not.toBeNull();
    // It removes rather than toggles, so it must not claim a pressed state.
    expect(chip!.hasAttribute("aria-pressed")).toBe(false);
    const glyph = chip!.querySelector("span");
    expect(glyph?.textContent).toBe("×");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");

    const byText = (text: string) =>
      [...doc.querySelectorAll("button")].find((b) => b.textContent!.trim() === text);
    expect(byText("Nausea")?.getAttribute("aria-pressed")).toBe("true");
    expect(byText("Headache")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("gives unselected chips and the Add button the control boundary, not the decorative hairline", () => {
    const buttons = [...doc.querySelectorAll("button")];
    // The severity buttons are aria-pressed too, but borderless and named by
    // aria-label, so they are left out rather than asserted into a border.
    const resting = [
      ...buttons.filter(
        (b) => b.getAttribute("aria-pressed") === "false" && !b.hasAttribute("aria-label"),
      ),
      buttons.find((b) => b.textContent!.trim() === "Add")!,
    ];
    expect(resting.length).toBeGreaterThan(1);
    for (const button of resting) {
      expect(button.classList.contains("border-border-strong"), button.outerHTML).toBe(true);
      expect(button.classList.contains("border-glass-border"), button.outerHTML).toBe(false);
    }
  });
});
