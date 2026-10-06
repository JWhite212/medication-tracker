// The /log row's × really mounted (jsdom, client svelte) and driven through
// the shared dose-write primitive and the real Toast. What matters here is
// which tap sends a delete, which one the (app) layout's one lock refuses,
// what the Undo offer says, and where focus lands after the reload — none of
// which SSR markup can show. The markup half (names, sizes, the
// pre-hydration type="button") is in tests/unit/timeline-entry-ssr.test.ts;
// the page's own grouping and h1 are in tests/unit/log-page-mount.svelte.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoseLogWithMedication } from "$lib/types";

const h = vi.hoisted(() => ({
  /** Every submit that reached `enhance` and was not cancelled, waiting for the test to answer it. */
  sent: [] as Array<{
    action: string | null;
    fields: Record<string, FormDataEntryValue>;
    finish: (result: ActionResult) => Promise<void>;
  }>,
  /** Submits the primitive cancelled before anything was sent. */
  cancelled: 0,
  /** SvelteKit's `update`. No dose write may call it. */
  update: vi.fn(async () => {}),
  /** The reload `reloadAfterWrite` runs. Each test decides what it does to the DOM. */
  invalidateAll: vi.fn(async () => {}),
}));

// The Undo registry and Toast's list are no-ops outside the browser.
vi.mock("$app/environment", () => ({
  browser: true,
  dev: false,
  building: false,
  version: "test",
}));
// The real idle shapes: reloadAfterWrite reads `navigating` before it reloads.
vi.mock("$app/state", () => ({
  page: { url: new URL("https://medtracker.test/log"), data: {} },
  navigating: { from: null, to: null, type: null, willUnload: null, delta: null, complete: null },
  updated: { current: false, check: async () => false },
}));
vi.mock("$app/navigation", () => ({
  invalidateAll: () => h.invalidateAll(),
  afterNavigate: () => {},
  beforeNavigate: () => {},
  goto: async () => {},
}));
// SvelteKit's `enhance`, reduced to its two-phase contract: the submit
// function runs when the form submits, and the callback it returns runs when
// the test answers. A cancelled submit sends nothing, as in SvelteKit.
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      const formData = new FormData(form);
      const action = new URL(form.getAttribute("action") ?? "", "https://medtracker.test/log");
      let cancelled = false;
      const callback = await submit({
        action,
        formData,
        formElement: form,
        controller: new AbortController(),
        submitter: e.submitter,
        cancel: () => {
          cancelled = true;
        },
      });
      if (cancelled) {
        h.cancelled++;
        return;
      }
      h.sent.push({
        action: form.getAttribute("action"),
        fields: Object.fromEntries(formData),
        finish: async (result) => {
          if (typeof callback === "function") {
            await callback({ action, formData, formElement: form, result, update: h.update });
          }
        },
      });
    };
    form.addEventListener("submit", onSubmit);
    return { destroy: () => form.removeEventListener("submit", onSubmit) };
  },
  applyAction: async () => {},
  deserialize: (text: string) => JSON.parse(text),
}));

import TimelineEntry from "$lib/components/TimelineEntry.svelte";
import Toast, { clearToasts } from "$lib/components/ui/Toast.svelte";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import {
  RESTORE_ACTION,
  RESTORED_TOAST,
  STILL_SAVING_TOAST,
} from "$lib/components/dose-writes/copy";
import { doseWriteContext } from "./helpers/dashboard-context";

function makeDose(
  id: string,
  name: string,
  dosageAmount: string,
  dosageUnit: string,
  takenAt: string,
): DoseLogWithMedication {
  return {
    id,
    userId: "user-1",
    medicationId: `med-${id}`,
    quantity: 1,
    takenAt: new Date(takenAt),
    loggedAt: new Date(takenAt),
    updatedAt: new Date(takenAt),
    notes: null,
    sideEffects: null,
    status: "taken",
    medication: {
      name,
      dosageAmount,
      dosageUnit,
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
  };
}

// Newest first, as the page lists them: two today, two yesterday.
const A = makeDose("a", "Vitamin D", "1000", "IU", "2026-04-16T08:00:00Z");
const B = makeDose("b", "Magnesium", "400", "mg", "2026-04-16T07:00:00Z");
const C = makeDose("c", "Omega-3", "1000", "mg", "2026-04-15T21:30:00Z");
const D = makeDose("d", "Iron", "14", "mg", "2026-04-15T08:00:00Z");

const DELETED_AT = "2026-04-16T09:00:00.000Z";

/** What `deleteDoseAction` answers for a delete it kept for Undo. */
function deleted(id: string): ActionResult {
  return {
    type: "success",
    status: 200,
    data: { success: true, doseId: id, restore: { deletedAt: DELETED_AT, expiresInMs: 600_000 } },
  };
}

const onedit = vi.fn();
let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.sent.length = 0;
  h.cancelled = 0;
  h.update.mockClear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockImplementation(async () => {});
  onedit.mockClear();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  resetUndoRegistry();
  clearToasts();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Group = { dayLabel: string | null; doses: DoseLogWithMedication[] };
type MountedRow = {
  component: ReturnType<typeof mount>;
  list: HTMLElement;
  index: number;
  dose: DoseLogWithMedication;
  dayLabel: string | null;
};

/**
 * The /log page's structure by hand: an h1 that takes focus, one role="list"
 * per day group, a row per dose, and the real Toast, all under one layout
 * lock. `drop` and `restore` are what the reload does after a delete and
 * after its Undo: the row goes, then the same id comes back where it was.
 */
function renderLog(groups: Group[], lock: DoseWriteLock = createDoseWriteLock()) {
  const context = doseWriteContext(lock);
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = "Dose History";
  document.body.append(heading);

  const live = new Map<string, MountedRow>();
  const gone = new Map<string, MountedRow>();

  function mountRow(
    list: HTMLElement,
    index: number,
    dose: DoseLogWithMedication,
    dayLabel: string | null,
  ) {
    const component = mount(TimelineEntry, {
      target: list,
      anchor: list.children[index] ?? undefined,
      props: { dose, timezone: "UTC", timeFormat: "24h", dayLabel, onedit },
      context,
    });
    live.set(dose.id, { component, list, index, dose, dayLabel });
  }

  for (const group of groups) {
    const list = document.createElement("div");
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", group.dayLabel ?? "Today");
    document.body.append(list);
    group.doses.forEach((dose, index) => mountRow(list, index, dose, group.dayLabel));
  }
  const toast = mount(Toast, { target: document.body, context });
  flushSync();

  cleanup = () => {
    for (const row of live.values()) unmount(row.component);
    unmount(toast);
    document.body.innerHTML = "";
  };

  return {
    heading,
    drop(id: string) {
      const row = live.get(id);
      if (!row) throw new Error(`no row ${id} to drop`);
      unmount(row.component);
      live.delete(id);
      gone.set(id, row);
      flushSync();
    },
    restore(id: string) {
      const row = gone.get(id);
      if (!row) throw new Error(`no dropped row ${id} to restore`);
      gone.delete(id);
      mountRow(row.list, row.index, row.dose, row.dayLabel);
      flushSync();
    },
  };
}
type Log = ReturnType<typeof renderLog>;

const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-dose-id="${id}"]`);
const editButton = (id: string) =>
  document.querySelector<HTMLElement>(`[data-dose-id="${id}"] [data-edit]`);
const stackText = () => document.querySelector("[data-toast-stack]")?.textContent ?? "";

function deleteButton(id: string): HTMLButtonElement {
  const x = document.querySelector<HTMLButtonElement>(
    `[data-dose-id="${id}"] button[aria-label^="Delete dose of"]`,
  );
  if (!x) throw new Error(`no × for ${id}`);
  return x;
}

function undoButton(): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-toast-stack] button")];
  const undo = buttons.find((b) => b.textContent?.trim() === "Undo");
  if (!undo) throw new Error("no Undo button in the toast stack");
  return undo;
}

/** Let the component's awaits and the enhance mock's finish. */
async function settle() {
  flushSync();
  for (let i = 0; i < 5; i++) await tick();
  flushSync();
}

/** Focus × and activate it, the way a keyboard or a pointer does. */
async function pressDelete(id: string) {
  const x = deleteButton(id);
  x.focus();
  x.click();
  await settle();
}

/** Press ×, answer the delete as the server does, and reload as the page would. */
async function deleteAndReload(log: Log, id: string) {
  h.invalidateAll.mockImplementationOnce(async () => log.drop(id));
  const before = h.sent.length;
  await pressDelete(id);
  expect(h.sent, `× on ${id} sent nothing`).toHaveLength(before + 1);
  const sent = h.sent[before];
  expect(sent.fields).toEqual({ doseId: id });
  await sent.finish(deleted(id));
  await settle();
}

describe("× deletes on the first tap", () => {
  it("is a submit once mounted, and one tap sends ?/deleteDose with this dose's id, asking nothing first", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    const x = deleteButton("a");
    expect(x.type).toBe("submit");
    // e2e selects × by the substring "Delete dose"; the name must not change.
    expect(x.getAttribute("aria-label")).toBe("Delete dose of Vitamin D at 8:00");
    expect(x.hasAttribute("aria-expanded")).toBe(false);

    await pressDelete("a");

    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].action).toBe("?/deleteDose");
    expect(h.sent[0].fields).toEqual({ doseId: "a" });
    expect(document.querySelector('[role="group"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/can't be undone/i);
  });

  it("does not open the edit dialog from ×, or from the gap beside it; the row itself still does", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    await pressDelete("a");
    // The wrapper around ✎ and ×'s form: a click on it is one in the gap.
    deleteButton("a").closest("form")!.parentElement!.click();
    expect(onedit).not.toHaveBeenCalled();

    rowOf("a")!.click();
    expect(onedit).toHaveBeenCalledTimes(1);
    expect(onedit).toHaveBeenCalledWith(A);
  });

  it("swallows a held Enter on ×, so holding the key cannot run on into the next row", () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    const x = deleteButton("a");
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const held = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    x.dispatchEvent(first);
    x.dispatchEvent(held);
    expect(first.defaultPrevented).toBe(false);
    expect(held.defaultPrevented).toBe(true);
  });

  it("shows it is busy with aria-disabled, a spinner and aria-busy on the row, never `disabled`", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    const x = deleteButton("a");
    await pressDelete("a");

    expect(x.getAttribute("aria-disabled")).toBe("true");
    expect(x.disabled).toBe(false);
    expect(x.querySelector(".animate-spin")).not.toBeNull();
    expect(rowOf("a")!.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(x);

    await h.sent[0].finish({ type: "failure", status: 404, data: { error: "Dose not found" } });
    await settle();

    expect(x.querySelector(".animate-spin")).toBeNull();
    expect(rowOf("a")!.hasAttribute("aria-busy")).toBe(false);
    expect(stackText()).toContain("Dose not found");
    // Focus was never lost, so a failure leaves it where the user put it.
    expect(document.activeElement).toBe(x);
  });
});

describe("the (app) layout's one lock", () => {
  it("refuses another row's × while a delete is in flight, and says so", async () => {
    renderLog([{ dayLabel: null, doses: [A, B] }]);
    await pressDelete("a");
    await pressDelete("b");

    expect(h.sent).toHaveLength(1);
    expect(h.cancelled).toBe(1);
    expect(stackText()).toContain(STILL_SAVING_TOAST);
  });

  it("refuses another row's × inside the cooldown after a delete, and takes it once the cooldown ends", async () => {
    const log = renderLog([{ dayLabel: null, doses: [A, B] }]);
    await deleteAndReload(log, "a");
    // Past a zero-length cooldown, well inside the real one.
    await vi.advanceTimersByTimeAsync(1);

    await pressDelete("b");
    expect(h.sent).toHaveLength(1);
    expect(h.cancelled).toBe(1);
    expect(deleteButton("b").getAttribute("aria-disabled")).toBe("true");
    // The cooldown alone is not "still saving", so it says nothing.
    expect(stackText()).not.toContain(STILL_SAVING_TOAST);

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    await settle();
    expect(deleteButton("b").hasAttribute("aria-disabled")).toBe(false);
    await pressDelete("b");
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].fields).toEqual({ doseId: "b" });
  });
});

describe("the Undo offer", () => {
  it.each<[string | null, string]>([
    [null, "Dose removed: Vitamin D 1000IU at 8:00"],
    ["Yesterday", "Dose removed: Vitamin D 1000IU yesterday at 8:00"],
    ["Wed 15 Apr", "Dose removed: Vitamin D 1000IU on Wed 15 Apr at 8:00"],
  ])(
    "offers a restore carrying the server's handle, placing a row under %s by its day",
    async (dayLabel, message) => {
      const log = renderLog([{ dayLabel, doses: [A] }]);
      await deleteAndReload(log, "a");

      expect(currentUndo()).toMatchObject({
        kind: "restore",
        doseId: "a",
        deletedAt: DELETED_AT,
        message,
      });
      expect(stackText()).toContain(message);
    },
  );

  it("withdraws an offer for this dose as soon as × sends", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    offerUndo({
      message: "Vitamin D 1000IU logged at 8:00",
      doseId: "a",
      kind: "delete",
      focusTarget: () => null,
    });

    await pressDelete("a");

    expect(h.sent).toHaveLength(1);
    expect(currentUndo()).toBeNull();
  });

  it("leaves an offer for a different dose alone", async () => {
    renderLog([{ dayLabel: null, doses: [A] }]);
    offerUndo({
      message: "Omega-3 1000mg logged at 21:30",
      doseId: "c",
      kind: "delete",
      focusTarget: () => null,
    });

    await pressDelete("a");

    expect(currentUndo()?.doseId).toBe("c");
  });
});

describe("focus after a delete, and after its Undo (Review Focus #4)", () => {
  it("moves from the last dose of a day to the next day's first ✎, and Undo brings it to the restored row's ✎", async () => {
    const log = renderLog([
      { dayLabel: null, doses: [A] },
      { dayLabel: "Yesterday", doses: [C, D] },
    ]);

    await deleteAndReload(log, "a");

    expect(rowOf("a")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(editButton("c"));

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ type: "success", status: 200, data: { success: true, doseId: "a" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    h.invalidateAll.mockImplementationOnce(async () => log.restore("a"));

    // The keyboard user tabs into the toast stack and presses Undo there.
    const undo = undoButton();
    undo.focus();
    undo.click();
    await vi.waitFor(() => expect(stackText()).toContain(RESTORED_TOAST));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RESTORE_ACTION);
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("doseId")).toBe("a");
    expect((init?.body as FormData).get("deletedAt")).toBe(DELETED_AT);
    expect(rowOf("a")).not.toBeNull();
    expect(document.activeElement).toBe(editButton("a"));
    expect(h.update).not.toHaveBeenCalled();
  });

  it("goes below first, crossing day groups, then above, then to the h1, never to a ×", async () => {
    const log = renderLog([
      { dayLabel: null, doses: [A, B] },
      { dayLabel: "Yesterday", doses: [C] },
    ]);

    // B is the last of today: the next row down is yesterday's C.
    await deleteAndReload(log, "b");
    expect(document.activeElement).toBe(editButton("c"));

    // C is the last row on the page: nothing is below it, so the nearest row above.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    await deleteAndReload(log, "c");
    expect(document.activeElement).toBe(editButton("a"));

    // A was the only row left.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    await deleteAndReload(log, "a");
    expect(document.activeElement).toBe(log.heading);
  });
});
