// Clear filter is rendered only while a medication is selected, so pressing
// it unmounts the focused button. Focus used to fall to <body> with the
// popover still open: the analytics page's goto passes keepFocus, so nothing
// restored it. It now returns to the trigger, the same place Escape sends it.
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

function openSelect(selectedIds: string[]) {
  const onchange = vi.fn();
  const target = document.body.appendChild(document.createElement("div"));
  mounted.push(
    mount(MedicationFilterSelect, {
      target,
      props: { medications: MEDS, selectedIds, onchange },
    }),
  );
  flushSync();
  const trigger = target.querySelector("button")!;
  trigger.click();
  flushSync();
  const clear = [...target.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "Clear filter",
  )!;
  return { target, trigger, clear, onchange };
}

describe("MedicationFilterSelect Clear filter focus", () => {
  it("returns focus to the trigger when the focused Clear filter removes itself", () => {
    const { target, trigger, clear, onchange } = openSelect(["m1"]);
    clear.focus();
    expect(document.activeElement).toBe(clear);
    clear.click();
    flushSync();
    expect(onchange).toHaveBeenCalledWith([]);
    expect(clear.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(trigger);
    // The popover stays open, so the next Tab lands back on its checkboxes.
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(target.querySelector('[role="group"]')).not.toBeNull();
  });

  it("moves no focus when the press focused nothing inside the popover", () => {
    const { clear } = openSelect(["m1"]);
    const elsewhere = document.body.appendChild(document.createElement("button"));
    elsewhere.focus();
    clear.click();
    flushSync();
    expect(document.activeElement).toBe(elsewhere);
  });
});
