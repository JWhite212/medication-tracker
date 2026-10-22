// MedicationFilterSelect mounted for real (jsdom, client svelte).
//
// Its trigger is deliberately not a Button or a Toggle. The resting look
// carries state -- an accent boundary while a filter is applied -- which no
// Button variant has and a call-site `class` cannot add: Tailwind v4 emits
// same-property utilities in name order, so `border-accent-ink/60` came out
// BEFORE `border-border-strong` and lost, which hid this trigger's own
// "filtered" cue from the day it was written. And Toggle forces aria-pressed
// onto what is a disclosure and must say aria-expanded. These tests pin the
// pieces the primitives would have given it: the shared 36px height, the
// focus ring, the control boundary, and exactly one boundary at a time.
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import MedicationFilterSelect from "$lib/components/MedicationFilterSelect.svelte";

const MEDS = [
  { id: "m1", name: "Ibuprofen", colour: "#ef4444", isArchived: false },
  { id: "m2", name: "Metformin", colour: "#10b981", isArchived: false },
];

const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
  for (const component of mounted.splice(0)) unmount(component);
  document.body.replaceChildren();
});

/** Mounts into a fresh host, registers the unmount, and hands back the trigger. */
function mountSelect(selectedIds: string[]) {
  const onchange = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  mounted.push(
    mount(MedicationFilterSelect, {
      target,
      props: { medications: MEDS, selectedIds, onchange },
    }),
  );
  flushSync();
  const trigger = target.querySelector("button")!;
  return { target, trigger, onchange };
}

describe("MedicationFilterSelect", () => {
  it("keeps a bespoke trigger at the shared 36px height, with aria-expanded, its chevron and the focus ring", () => {
    const { trigger } = mountSelect([]);
    expect(trigger.getAttribute("type")).toBe("button");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect([...trigger.classList]).toEqual(
      expect.arrayContaining(["h-9", "focus-visible:outline-accent-ink"]),
    );
    trigger.click();
    flushSync();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("draws an applied filter with the accent boundary instead of, not beside, the neutral one", () => {
    const filtered = [...mountSelect(["m1"]).trigger.classList];
    expect(filtered).toContain("border-accent-ink");
    expect(filtered).not.toContain("border-border-strong");
    const all = [...mountSelect([]).trigger.classList];
    expect(all).toContain("border-border-strong");
    expect(all).not.toContain("border-accent-ink");
  });

  it("offers Clear filter as a full-width ghost Button that clears the selection", () => {
    const { target, trigger, onchange } = mountSelect(["m1"]);
    trigger.click();
    flushSync();
    const clear = [...target.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Clear filter",
    )!;
    expect(clear.getAttribute("type")).toBe("button");
    expect([...clear.classList]).toEqual(
      expect.arrayContaining([
        "h-9",
        "w-full",
        "text-text-secondary",
        "focus-visible:outline-accent-ink",
      ]),
    );
    expect([...clear.classList]).not.toContain("border");
    clear.click();
    flushSync();
    expect(onchange).toHaveBeenCalledWith([]);
  });
});
