// Where focus lands after a Due row resolves, with DueCards really mounted.
// The order is: the same card if it survived the reload, else the next card
// that was rendered below it at the tap, else the page's h1. The tap-time
// snapshot is what makes "the next card" answerable: after the reload the
// resolved card is gone and the DOM can no longer say what followed it. A
// Log now's Undo offer sends focus by the same rule, once the Undo's own
// reload has brought the row back.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
}));

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({
  page: {
    data: {
      done: [],
      todayStart: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
      preferences: { timeFormat: "24h" },
    },
  },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DueCard from "$lib/components/dashboard/DueCard.svelte";
import type { DueCard as DueCardData } from "$lib/types";
import { currentUndo, resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const SUCCESS = { type: "success", status: 200, data: { success: true, doseId: "d-new" } } as const;

/** One card whose only row is due now and offers Log now alone. */
function card(medicationId: string, name: string, expectedTime: string): DueCardData {
  return {
    key: `today:${medicationId}`,
    medicationId,
    name,
    dosageAmount: "10",
    dosageUnit: "mg",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    rows: [
      {
        key: `${medicationId}@${expectedTime}`,
        kind: "fixed_time",
        expectedTime,
        state: "due-now",
        logNow: true,
        tookItAt: null,
        skipAt: null,
      },
    ],
  };
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  resetUndoRegistry();
  vi.useRealTimers();
});

function setup() {
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  const list = document.createElement("ul");
  document.body.append(heading, list);
  const context = dashboardContext({ now: NOW });
  const alive = new Map<string, ReturnType<typeof mount>>();
  /** Render a card, as a reload that brings its row back does. */
  const addCard = (data: DueCardData) => {
    alive.set(
      data.key,
      mount(DueCard, {
        target: list,
        props: {
          card: data,
          serverNow: NOW,
          todayStart: TODAY_START,
          timezone: "UTC",
          timeFormat: "24h",
          focusAfter: () => heading,
        },
        context,
      }),
    );
    flushSync();
  };
  /** What a reload does to a resolved card: it is gone. */
  const removeCard = (key: string) => {
    const component = alive.get(key);
    if (component) unmount(component);
    alive.delete(key);
    flushSync();
  };
  addCard(card("m1", "Metformin", "2026-05-01T12:45:00.000Z"));
  addCard(card("m2", "Lisinopril", "2026-05-01T13:00:00.000Z"));
  addCard(card("m3", "Atorvastatin", "2026-05-01T13:15:00.000Z"));
  cleanup = () => {
    for (const component of alive.values()) unmount(component);
    alive.clear();
    list.remove();
    heading.remove();
  };
  const cardEl = (key: string) => list.querySelector<HTMLElement>(`[data-card-key="${key}"]`);
  return { heading, cardEl, addCard, removeCard };
}

/** Tap a card's Log now: the card's capture-phase snapshot first, then enhance's submit. */
async function tapLogNow(cardElement: HTMLElement) {
  const form = cardElement.querySelector<HTMLFormElement>('form[action="?/logDose"]');
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the card's Log now never attached use:enhance");
  // The browser fires submit before enhance's handler runs; the card's
  // capture listener sees it first and snapshots the order.
  form.dispatchEvent(
    new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
      submitter: form.querySelector("button"),
    }),
  );
  const { callback } = await startSubmit(submit, form);
  return { form, callback: callback! };
}

describe("DueCard focus after its row resolves", () => {
  it("moves to the next card below when the tapped card is gone, not back to the top", async () => {
    const { heading, cardEl, removeCard } = setup();
    const { form, callback } = await tapLogNow(cardEl("today:m2")!);
    // The reload is invalidateAll; it re-renders the resolved card away.
    h.invalidateAll.mockImplementationOnce(async () => removeCard("today:m2"));

    await finishSubmit(callback, form, SUCCESS).done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(cardEl("today:m3"));
    expect(document.activeElement).not.toBe(cardEl("today:m1"));
    expect(document.activeElement).not.toBe(heading);
  });

  it("a Log now's Undo sends focus back to its card once the Undo's reload brings the row back, else the card below, else the h1", async () => {
    const { heading, cardEl, addCard, removeCard } = setup();
    const { form, callback } = await tapLogNow(cardEl("today:m2")!);
    h.invalidateAll.mockImplementationOnce(async () => removeCard("today:m2"));
    await finishSubmit(callback, form, SUCCESS).done;

    const offer = currentUndo();
    expect(offer).toMatchObject({ kind: "delete", doseId: "d-new" });
    // Before the Undo runs the row is still resolved: the card that was below it.
    expect(offer!.focusTarget()).toBe(cardEl("today:m3"));
    // The Undo's reload brings the row, and its card, back.
    addCard(card("m2", "Lisinopril", "2026-05-01T13:00:00.000Z"));
    expect(offer!.focusTarget()).toBe(cardEl("today:m2"));
    // With no card left at all, the page's h1.
    for (const key of ["today:m1", "today:m2", "today:m3"]) removeCard(key);
    expect(offer!.focusTarget()).toBe(heading);
  });
});
