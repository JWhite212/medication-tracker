// Covers: where keyboard focus lands when a fixed time's Remove takes its row
// off the medication form, what each Remove is called, and that "?" closes
// the keyboard-shortcuts overlay it opened. Both need the components mounted
// and driven; the SSR suites cannot press anything.
//
// Does NOT cover: Tab movement (jsdom implements none, see focus-trap.test.ts)
// or the side-effect picker's own focus (accessible-pickers-focus.svelte.test.ts).
// What it asserts is `document.activeElement`, which jsdom tracks faithfully,
// including falling back to <body> when the focused element is removed or
// becomes disabled.
//
// `.svelte.test.ts` so `$state` can stand in for MedicationForm, which binds
// `fixedTimes` and is the only thing that ever shortens it.
import { describe, it, expect, afterEach, vi } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";

vi.mock("$app/navigation", () => ({ goto: vi.fn() }));

import ScheduleSection from "../../src/lib/components/medication-form/MedicationScheduleSection.svelte";
import KeyboardShortcuts from "../../src/lib/components/KeyboardShortcuts.svelte";

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

/** Presses a button the way a keyboard user does: it has focus first. */
async function press(button: HTMLElement): Promise<void> {
  button.focus();
  expect(document.activeElement).toBe(button);
  button.click();
  await settle();
}

describe("MedicationScheduleSection's Remove", () => {
  function mountSchedule(fixedTimes: string[]) {
    const target = host();
    const props = $state({
      mode: "fixed_time" as const,
      intervalHours: "",
      fixedTimes,
      daysOfWeek: [] as number[],
      errors: {},
    });
    const component = mount(ScheduleSection, { target, props });
    teardown.push(() => unmount(component));
    flushSync();
    return { target, props };
  }

  const removes = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].filter(
      (b) => b.textContent?.trim() === "Remove",
    );
  const times = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLInputElement>('input[type="time"]')].map((i) => i.value);

  it("names each Remove by the time it removes", () => {
    const { target } = mountSchedule(["08:00", "14:00", "20:00"]);
    expect(removes(target).map((b) => b.getAttribute("aria-label"))).toEqual([
      "Remove 08:00",
      "Remove 14:00",
      "Remove 20:00",
    ]);
  });

  it("moves focus to the previous row's Remove when the last row is removed", async () => {
    // Keyed by index, the last row's DOM is the one unmounted, so the
    // focused button left the page and focus fell to <body>.
    const { target, props } = mountSchedule(["08:00", "14:00", "20:00"]);
    const [, second, third] = removes(target);
    await press(third);
    expect(props.fixedTimes).toEqual(["08:00", "14:00"]);
    expect(third.isConnected).toBe(false);
    expect(document.activeElement).toBe(second);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove 14:00");
  });

  it("moves focus to the next row's own Remove, not to the pressed button relabelled", async () => {
    // Keyed by index, removing 08:00 kept its button and relabelled it as
    // 14:00's, and deleted the last row's button instead.
    const { target, props } = mountSchedule(["08:00", "14:00", "20:00"]);
    const [first, second] = removes(target);
    await press(first);
    expect(props.fixedTimes).toEqual(["14:00", "20:00"]);
    expect(times(target)).toEqual(["14:00", "20:00"]);
    expect(first.isConnected).toBe(false);
    expect(document.activeElement).toBe(second);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Remove 14:00");
  });

  it("keeps focus on the page going from two rows to one, the survivor aria-disabled", async () => {
    // The surviving button used to become natively `disabled`, which drops a
    // focused control to <body>.
    const { target } = mountSchedule(["08:00", "20:00"]);
    const [first] = removes(target);
    await press(first);
    const [only] = removes(target);
    expect(document.activeElement).toBe(only);
    expect(only.getAttribute("aria-label")).toBe("Remove 20:00");
    expect(only.hasAttribute("disabled")).toBe(false);
    expect(only.getAttribute("aria-disabled")).toBe("true");
  });

  it("does nothing when the only row's Remove is pressed, and keeps it focused", async () => {
    const { target, props } = mountSchedule(["08:00"]);
    const [only] = removes(target);
    expect(only.getAttribute("aria-disabled")).toBe("true");
    await press(only);
    expect(props.fixedTimes).toEqual(["08:00"]);
    expect(only.isConnected).toBe(true);
    expect(document.activeElement).toBe(only);
  });

  it("leaves focus alone when nothing was focused at the press", async () => {
    // Safari focuses no button it taps: the press took nothing away.
    const { target } = mountSchedule(["08:00", "14:00"]);
    const [, second] = removes(target);
    (document.activeElement as HTMLElement | null)?.blur();
    second.click();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("KeyboardShortcuts' overlay", () => {
  function mountShortcuts() {
    const target = host();
    const component = mount(KeyboardShortcuts, { target, props: {} });
    teardown.push(() => unmount(component));
    flushSync();
    return target;
  }

  function key(k: string) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    flushSync();
  }

  const dialog = () => document.querySelector('[role="dialog"][aria-label="Keyboard shortcuts"]');

  async function openOverlay() {
    (document.activeElement as HTMLElement | null)?.blur();
    key("?");
    await tick();
    await settle();
    expect(dialog()).not.toBeNull();
    // Opening it focuses its Close button, which is what the old guard tripped on.
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close");
  }

  it("closes with ? while its own Close button has focus", async () => {
    mountShortcuts();
    await openOverlay();
    key("?");
    expect(dialog()).toBeNull();
  });

  it("stays open when a held ? auto-repeats right after opening it", async () => {
    mountShortcuts();
    await openOverlay();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "?", repeat: true, bubbles: true, cancelable: true }),
    );
    flushSync();
    expect(dialog()).not.toBeNull();
  });

  it("still closes with Escape while its Close button has focus", async () => {
    mountShortcuts();
    await openOverlay();
    key("Escape");
    expect(dialog()).toBeNull();
  });

  it("does not open with ? while a control outside it has focus", () => {
    const target = mountShortcuts();
    const button = target.appendChild(document.createElement("button"));
    button.focus();
    key("?");
    expect(dialog()).toBeNull();
  });
});
