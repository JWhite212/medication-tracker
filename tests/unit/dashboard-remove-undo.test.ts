// The dashboard edit dialog's "Remove this dose" is a delete, so it offers
// an Undo that restores the dose, and that Undo's focus lands on the
// restored Done row's Edit. Mounted as the whole page (jsdom, client svelte),
// because the dialog, its Remove and the Done list only meet there; the
// Remove form's use:enhance callback is driven by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DashboardPageData, DoneRow, Medication } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy: () => void h.submits.delete(form) };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: vi.fn(async () => {}),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll(), goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { createDoseWriteLock } from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { buttonNamed } from "./helpers/dom-names";

// The (app) layout adds `user` and `preferences` to the merged PageData, and
// svelte-check types this fixture against it.
const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

const metformin: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};

const TAKEN_AT = new Date("2026-05-01T13:31:00.000Z");
const DELETED_AT = "2026-05-01T14:00:05.000Z";

const D1: DoneRow = {
  key: "d1",
  dose: {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    status: "taken",
    takenAt: TAKEN_AT,
    loggedAt: TAKEN_AT,
    updatedAt: TAKEN_AT,
    notes: null,
    sideEffects: null,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#ff0000",
      colourSecondary: null,
      pattern: "solid",
    },
  },
  covers: [],
  dayLabel: null,
};

const DASH: DashboardPageData = {
  now: "2026-05-01T14:00:00.000Z",
  nextRefreshAt: "2026-05-01T15:00:00.000Z",
  timezone: "UTC",
  todayStart: "2026-05-01T00:00:00.000Z",
  status: {
    kind: "all-done",
    dueCount: 0,
    doneToday: 1,
    totalToday: 1,
    loggedToday: 1,
    next: null,
  },
  earlier: [],
  today: [],
  done: [D1],
  later: [],
  medications: [metformin],
  refillForecast: [],
};

const REMOVED: ActionResult = {
  type: "success",
  status: 200,
  data: {
    success: true,
    doseId: "d1",
    restore: { deletedAt: DELETED_AT, expiresInMs: DOSE_UNDO_WINDOW_MS },
  },
};

const EDIT_D1 = "Edit: Metformin 500mg dose taken at 13:31";

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  target = document.body.appendChild(document.createElement("div"));
  // The lock is the (app) layout's; the page reads it from context.
  app = mount(Page, {
    target,
    props: { data: { ...DASH, user, preferences } },
    context: doseWriteContext(createDoseWriteLock()),
  });
  flushSync();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
});

/** Open the edit dialog on d1 and return its Remove form. */
function openRemove() {
  buttonNamed(target, EDIT_D1).click();
  flushSync();
  const form = buttonNamed(target, "Remove this dose").closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the dialog's Remove is not a use:enhance form");
  return { form, submit };
}

describe("the edit dialog's Remove this dose", () => {
  it("offers an Undo that restores the dose, naming the dose and its time", async () => {
    const { form, submit } = openRemove();
    expect(form.getAttribute("action")).toBe("?/deleteDose");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, REMOVED).done;
    flushSync();

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      deletedAt: DELETED_AT,
      expiresInMs: DOSE_UNDO_WINDOW_MS,
      message: "Dose removed: Metformin 500mg at 13:31",
    });
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(target.querySelector('[role="dialog"]'), "the dialog should close").toBeNull();
  });

  it("sends the Undo's focus to the restored row's Edit", async () => {
    const { form, submit } = openRemove();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, REMOVED).done;
    flushSync();

    // invalidateAll is inert here, so d1 is still rendered: the page as the
    // restore's reload leaves it. The absent-row fallback (the Done heading)
    // is covered by done-list-undo.test.ts.
    expect(currentUndo()!.focusTarget()).toBe(buttonNamed(target, EDIT_D1));
  });

  it("withdraws an Undo for the same dose as soon as the Remove is sent", async () => {
    // Log now's Undo would delete this dose; once Remove is on its way, that
    // Undo acts on nothing.
    offerUndo({
      message: "Metformin 500mg logged at 13:31",
      doseId: "d1",
      kind: "delete",
      focusTarget: () => null,
    });
    const { form, submit } = openRemove();

    const { callback } = await startSubmit(submit, form);

    expect(callback).not.toBeNull();
    expect(currentUndo()).toBeNull();
  });
});

describe("the edit dialog's Remove on a dose taken before today's midnight", () => {
  // Done carries last night's late dose over into the morning. Its Edit says
  // "yesterday", so its Remove toast must too.
  const LATE = new Date("2026-04-30T22:00:00.000Z");
  const D0: DoneRow = {
    ...D1,
    key: "d0",
    dose: { ...D1.dose, id: "d0", takenAt: LATE, loggedAt: LATE, updatedAt: LATE },
    dayLabel: "yesterday",
  };

  it("names the day: 'Dose removed: … yesterday at 22:00'", async () => {
    if (app) unmount(app);
    app = mount(Page, {
      target,
      props: { data: { ...DASH, done: [D0, D1], user, preferences } },
      context: doseWriteContext(createDoseWriteLock()),
    });
    flushSync();

    buttonNamed(target, "Edit: Metformin 500mg dose taken at yesterday 22:00").click();
    flushSync();
    const form = buttonNamed(target, "Remove this dose").closest("form")!;
    const submit = h.submits.get(form)!;
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, {
      ...REMOVED,
      data: { ...(REMOVED as { data: Record<string, unknown> }).data, doseId: "d0" },
    } as ActionResult).done;
    flushSync();

    expect(currentUndo()?.message).toBe("Dose removed: Metformin 500mg yesterday at 22:00");
  });
});
