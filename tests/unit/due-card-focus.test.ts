// Where focus lands after a Due row resolves, with DueCards really mounted.
// The order is: the same card if it survived the reload, else the next card
// that was rendered below it at the tap, else the page's h1. The tap-time
// snapshot is what makes "the next card" answerable: after the reload the
// resolved card is gone and the DOM can no longer say what followed it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({ submits: new Map<HTMLFormElement, SubmitFunction>() }));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$app/state", () => ({
  page: {
    data: {
      done: [],
      todayStart: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
      preferences: { timeFormat: "24h" },
    },
  },
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DueCard from "$lib/components/dashboard/DueCard.svelte";
import type { DueCard as DueCardData } from "$lib/types";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");

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
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
});

function setup() {
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  const list = document.createElement("ul");
  document.body.append(heading, list);
  const context = dashboardContext({ now: NOW });
  const mounted = [
    card("m1", "Metformin", "2026-05-01T12:45:00.000Z"),
    card("m2", "Lisinopril", "2026-05-01T13:00:00.000Z"),
    card("m3", "Atorvastatin", "2026-05-01T13:15:00.000Z"),
  ].map((data) =>
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
  const alive = new Set(mounted);
  cleanup = () => {
    for (const component of alive) unmount(component);
    list.remove();
    heading.remove();
  };
  const cardEl = (key: string) => list.querySelector<HTMLElement>(`[data-card-key="${key}"]`)!;
  /** What the reload does to a resolved card: it is gone. */
  const removeCard = (index: number) => {
    unmount(mounted[index]);
    alive.delete(mounted[index]);
  };
  return { heading, cardEl, removeCard };
}

describe("DueCard focus after its row resolves", () => {
  it("moves to the next card below when the tapped card is gone, not back to the top", async () => {
    const { heading, cardEl, removeCard } = setup();
    const middle = cardEl("today:m2");
    const form = middle.querySelector<HTMLFormElement>('form[action="?/logDose"]')!;
    const submit = h.submits.get(form);
    if (!submit) throw new Error("the middle card's Log now never attached use:enhance");

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
    const update = vi.fn(async () => {
      removeCard(1);
      flushSync();
    });

    await finishSubmit(
      callback!,
      form,
      { type: "success", status: 200, data: { success: true, doseId: "d-new" } },
      update,
    ).done;

    expect(update).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(cardEl("today:m3"));
    expect(document.activeElement).not.toBe(cardEl("today:m1"));
    expect(document.activeElement).not.toBe(heading);
  });
});
