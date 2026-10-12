// Mounted in jsdom (the suite default) rather than rendered to a string,
// because these properties belong to a live DOM: where the card's Log posts
// once hydrated, which element holds focus while a log is in flight, the
// Undo it leaves behind, and the real parent chain between a row of the
// Medications list and the name inside its card. The class-level checks on
// the same controls are in medication-card-targets-ssr.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { MedicationWithStats } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  showToast: vi.fn(),
  invalidateAll: vi.fn(async () => {}),
}));

// SvelteKit's client runtime is not running here. `enhance` hands each
// form's submit function to the test, which drives it by hand; the rest is
// what the shared dose-write path reads.
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
// The Undo registry is a no-op unless `browser`, like Toast's list.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));

import MedicationCard from "../../src/lib/components/MedicationCard.svelte";
import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { currentUndo, resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
import { formatUserTime } from "$lib/utils/time";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

type ListedMedication = MedicationWithStats & {
  sparkline: number[];
  refillSeverity: "critical" | "warning" | "watch" | "ok";
};

function medication(overrides: Partial<ListedMedication> = {}): ListedMedication {
  return {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 3,
    expectedDailyDoses: 3,
    sparkline: [1, 2, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3],
    refillSeverity: "critical",
    ...overrides,
  };
}

// The (app) layout adds these to every page's data; the medications page
// reads the zone and clock format from them for its cards.
const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};
const preferences = {
  userId: "u1",
  accentColor: "#6366f1",
  theme: "system",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: true,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "csv",
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

const LOGGED: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
// 01:31 UTC is 13:31 in Auckland (NZST, UTC+12, in May): a zone far enough
// from UTC that formatting in the wrong one cannot pass by accident.
const ARRIVAL = new Date("2026-05-01T01:31:00.000Z");
const ZONE = "Pacific/Auckland";

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let lock: DoseWriteLock;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(ARRIVAL);
  h.submits.clear();
  h.showToast.mockReset();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  lock = createDoseWriteLock();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountCard() {
  app = mount(MedicationCard, {
    target,
    props: { medication: medication(), timezone: ZONE, timeFormat: "24h" },
    context: doseWriteContext(lock),
  });
  flushSync();
  const button = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Log a dose of Paracetamol"]',
  )!;
  const form = button.closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the card's Log is not a use:enhance form");
  return { button, form, submit };
}

describe("the medication card's Log", () => {
  it("posts one dose to the dashboard's logDose through use:enhance, as a submit once hydrated", () => {
    const { button, form } = mountCard();
    expect(form.getAttribute("method")).toBe("POST");
    expect(form.getAttribute("action")).toBe("/dashboard?/logDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({ medicationId: "m1", quantity: "1" });
    expect(button.type).toBe("submit");
  });

  it("keeps keyboard focus while a dose is in flight, refuses a second log, and keeps it after", async () => {
    // A native `disabled` for the duration of the request dropped a keyboard
    // user to <body>; aria-disabled says the same and leaves focus alone.
    const { button, form, submit } = mountCard();
    expect(button.getAttribute("aria-disabled")).toBe("false");

    button.focus();
    const first = await startSubmit(submit, form);
    flushSync();
    expect(first.cancel).not.toHaveBeenCalled();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(button.querySelector("span")?.classList.contains("invisible")).toBe(true);

    // The shared lock, not a flag of the card's own, refuses the second tap.
    const second = await startSubmit(submit, form);
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(second.callback).toBeNull();

    await finishSubmit(first.callback!, form, LOGGED).done;
    flushSync();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    flushSync();
    expect(button.getAttribute("aria-disabled")).toBe("false");
  });

  it("offers an Undo that deletes the new dose, stating the log time in the user's zone", async () => {
    // The reload finishes a minute after the response arrived (a slow
    // invalidateAll, or one that waited out a navigation): 13:32 in Auckland.
    // The toast states when the log landed, 13:31, not when the page finished
    // reloading.
    const reloadedAt = ARRIVAL.getTime() + 60_000;
    h.invalidateAll.mockImplementationOnce(async () => {
      vi.setSystemTime(reloadedAt);
    });
    const { button, form, submit } = mountCard();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, LOGGED).done;
    flushSync();
    expect(Date.now(), "the stubbed reload moved the clock").toBe(reloadedAt);

    const message = `Paracetamol 500mg logged at ${formatUserTime(ARRIVAL, ZONE, "24h")}`;
    expect(message).toBe("Paracetamol 500mg logged at 13:31");
    expect(currentUndo()).toMatchObject({ kind: "delete", doseId: "d-new", message });
    // After the Undo, focus comes back to this Log.
    expect(currentUndo()!.focusTarget()).toBe(button);
    // The offer is the confirmation; the same sentence is not toasted twice.
    expect(h.showToast).not.toHaveBeenCalledWith(message, "success");
  });

  it("toasts the server's reason for a refused log and leaves no Undo", async () => {
    const { form, submit } = mountCard();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    }).done;

    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
    expect(currentUndo()).toBeNull();
  });
});

describe("the medications list's card column", () => {
  it("lets a long name break inside the card instead of widening it", () => {
    // A flex item's automatic minimum width is its min-content width, and
    // `overflow-wrap: break-word` does not lower that. The page's wrapper
    // round the card had no min-w-0, so at 320px a name such as this one
    // widened the whole card past the screen and pushed the Log button off
    // its edge. Every flex item between the row and the name has to be
    // allowed to shrink, so the card is sized by the row, not its content.
    const LONG = "Hydrochlorothiazide";
    const data = {
      user,
      preferences,
      medications: [medication({ id: "m1", name: LONG })],
      archived: [],
    } as unknown as ComponentProps<typeof MedicationsPage>["data"];
    app = mount(MedicationsPage, { target, props: { data }, context: doseWriteContext(lock) });

    const name = [...target.querySelectorAll("p")].find((p) => p.textContent === LONG)!;
    const row = name.closest(".space-y-3 > div")!;
    expect(row).not.toBeNull();

    const unshrinkable: string[] = [];
    for (let el: Element | null = name; el && el !== row; el = el.parentElement) {
      const parent = el.parentElement!;
      const inFlexLayout =
        parent.classList.contains("flex") || parent.classList.contains("inline-flex");
      if (inFlexLayout && !el.classList.contains("min-w-0")) {
        unshrinkable.push(`<${el.tagName.toLowerCase()} class="${el.className}">`);
      }
    }
    expect(unshrinkable).toEqual([]);

    // The backstop: `overflow-wrap: anywhere` lowers min-content itself, so
    // the name still breaks if a later change drops one of those min-w-0s.
    expect(name.closest(".wrap-anywhere")).not.toBeNull();
  });
});
