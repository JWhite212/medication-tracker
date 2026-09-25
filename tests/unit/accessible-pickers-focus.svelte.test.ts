// Covers: where keyboard focus lands when a control in the medication style
// picker or the side-effect picker takes itself off the page, and that the
// colour and pattern names shown in the legends follow the selection. Both
// need the components mounted and driven, which the SSR suite beside this one
// (accessible-pickers-ssr.test.ts) cannot do.
//
// Does NOT cover: Tab or arrow-key movement (jsdom does not implement either,
// see focus-trap.test.ts), or whether the browser paints a focus ring after a
// programmatic focus (`:focus-visible` heuristics). What it asserts is
// `document.activeElement`, which jsdom tracks faithfully, including falling
// back to <body> when the focused element is removed.
//
// The file is `.svelte.test.ts` so that `$state` can stand in for a parent:
// the side-effect picker is controlled, and removes a chip only once its
// parent hands back the shorter list. vite.config.ts resolves `svelte` to its
// client entry under vitest, which is what lets `mount()` and `tick()` work.
import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import MedicationStylePicker from "../../src/lib/components/medication-form/MedicationStylePicker.svelte";
import SideEffectPicker from "../../src/lib/components/SideEffectPicker.svelte";
import type { SideEffect } from "$lib/types";

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

function host(): HTMLElement {
  const target = document.body.appendChild(document.createElement("div"));
  teardown.push(() => target.remove());
  return target;
}

/** Lets the handler's own `await tick()` and whatever it queues run out. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function byLabel(root: ParentNode, label: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  expect(el, `no element labelled "${label}"`).not.toBeNull();
  return el!;
}

/** Presses a button the way a keyboard user does: it has focus first. */
async function press(button: HTMLElement): Promise<void> {
  button.focus();
  expect(document.activeElement).toBe(button);
  button.click();
  await settle();
}

describe("MedicationStylePicker focus", () => {
  function mountPicker(secondary: string | null): HTMLElement {
    const target = host();
    const component = mount(MedicationStylePicker, {
      target,
      props: {
        selectedColour: "#6366f1",
        selectedColourSecondary: secondary,
        selectedPattern: secondary ? "stripes" : "solid",
        errors: {},
      },
    });
    teardown.push(() => unmount(component));
    flushSync();
    return target;
  }

  it("moves focus from 'Add secondary colour' to the colour it just chose", async () => {
    // The button unmounts itself, so focus used to fall to <body> and a
    // keyboard user had to start again from the top of the page.
    const target = mountPicker(null);
    await press(byLabel(target, "Add secondary colour"));
    const checked = target.querySelector<HTMLInputElement>('input[name="colourSecondary"]:checked');
    expect(checked?.value).toBe("#a855f7");
    expect(document.activeElement).toBe(checked);
  });

  it("moves focus from 'Remove secondary colour' back to the button that adds one", async () => {
    const target = mountPicker("#f59e0b");
    await press(byLabel(target, "Remove secondary colour"));
    expect(target.querySelector('input[name="colourSecondary"]')).toBeNull();
    expect(document.activeElement).toBe(byLabel(target, "Add secondary colour"));
  });
});

describe("MedicationStylePicker visible names", () => {
  it("names the chosen colour and pattern in words beside each group, not only on hover", () => {
    const target = host();
    const component = mount(MedicationStylePicker, {
      target,
      props: {
        selectedColour: "#6366f1",
        selectedColourSecondary: "#f59e0b",
        selectedPattern: "solid",
        errors: {},
      },
    });
    teardown.push(() => unmount(component));
    flushSync();

    const legendOf = (name: string) =>
      target
        .querySelector(`input[name="${name}"]`)!
        .closest("fieldset")!
        .querySelector(":scope > legend")!;
    const shown = (name: string) =>
      (legendOf(name).querySelector('[aria-hidden="true"]')?.textContent ?? "").trim();

    expect(shown("colour")).toBe(": Indigo");
    expect(shown("colourSecondary")).toBe(": Amber");
    expect(shown("pattern")).toBe(": Solid");

    const pick = (name: string, value: string) => {
      target.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)!.click();
      flushSync();
    };
    pick("colour", "#14b8a6");
    pick("colourSecondary", "#ef4444");
    pick("pattern", "dots");

    expect(shown("colour")).toBe(": Teal");
    expect(shown("colourSecondary")).toBe(": Red");
    expect(shown("pattern")).toBe(": Polka Dots");
  });
});

describe("SideEffectPicker focus", () => {
  // The picker is controlled: a press calls `onchange`, and the chip goes
  // only when the parent passes the shorter list back, as DoseEditForm does.
  function mountPicker(initial: SideEffect[], opts: { ignoreChanges?: boolean } = {}) {
    const target = host();
    const props = $state({
      value: initial,
      onchange: (next: SideEffect[]) => {
        if (!opts.ignoreChanges) props.value = next;
      },
    });
    const component = mount(SideEffectPicker, { target, props });
    teardown.push(() => unmount(component));
    flushSync();
    return target;
  }

  const mild = (...names: string[]): SideEffect[] =>
    names.map((name) => ({ name, severity: "mild" }));

  it("moves focus to the next effect's own chip, not to the pressed chip relabelled", async () => {
    // Unkeyed, removing Hives rewrote the Hives button's text to "Itch" and
    // deleted the last button instead, so focus never moved and a screen
    // reader had no reason to announce anything: the user was silently on a
    // different effect's Remove button.
    const target = mountPicker(mild("Rash", "Hives", "Itch"));
    const hives = byLabel(target, "Remove Hives");
    const itch = byLabel(target, "Remove Itch");
    await press(hives);
    expect(hives.isConnected).toBe(false);
    expect(document.activeElement).toBe(itch);
  });

  it("falls back to the previous chip when the last one is removed", async () => {
    const target = mountPicker(mild("Rash", "Hives"));
    const rash = byLabel(target, "Remove Rash");
    await press(byLabel(target, "Remove Hives"));
    expect(document.activeElement).toBe(rash);
  });

  it("falls back to the 'Other side effect' field when no custom chip is left", async () => {
    const target = mountPicker([
      { name: "Nausea", severity: "mild" },
      { name: "Rash", severity: "severe" },
    ]);
    await press(byLabel(target, "Remove Rash"));
    const field = document.activeElement as HTMLInputElement;
    expect(field.tagName).toBe("INPUT");
    expect(field.labels?.[0]?.textContent?.trim()).toBe("Other side effect");
  });

  it("leaves focus alone when the parent does not remove the effect", async () => {
    const target = mountPicker(mild("Rash", "Hives"), { ignoreChanges: true });
    const hives = byLabel(target, "Remove Hives");
    await press(hives);
    expect(hives.isConnected).toBe(true);
    expect(document.activeElement).toBe(hives);
  });

  it("shows one chip per name, so a repeated name neither doubles the chip nor breaks the keyed list", async () => {
    // The /api/v1 door does not rule out two entries with one name. `toggle`
    // already treats them as one (it filters by name), and Svelte throws on a
    // repeated key, in production too.
    const target = mountPicker(mild("Rash", "Rash"));
    expect(target.querySelectorAll('[aria-label="Remove Rash"]')).toHaveLength(1);
    await press(byLabel(target, "Remove Rash"));
    expect(target.querySelector('[aria-label="Remove Rash"]')).toBeNull();
    expect((document.activeElement as HTMLInputElement).labels?.[0]?.textContent?.trim()).toBe(
      "Other side effect",
    );
  });
});
