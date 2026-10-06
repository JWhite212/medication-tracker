// Where focus lands after the dashboard edit dialog's "Remove this dose": the
// dose is gone, the reload dropped its Done row, and the dialog has closed
// over the button that held focus. Mounted as the whole page (jsdom, client
// svelte) because only there do the dialog, its Remove and the Done list's
// heading meet; it is a `.svelte.test.ts` so the page's `data` can be a
// `$state` that the reload really replaces, which is the part a hand-driven
// `invalidateAll` stub cannot show. dashboard-remove-undo.test.ts leaves the
// row rendered and covers the offer itself.
//
// This is the case the primitive's lost-focus rule used to miss: it judged
// focus while the Remove button was still in the open dialog (connected, so
// not lost) and only then let onSuccess close the dialog, which dropped focus
// to <body> with nothing left to move it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
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
import { resetUndoRegistry } from "$lib/components/dose-writes/undo-registry.svelte";
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

const WITH_D1: DashboardPageData = {
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

/** The same page once the server has deleted d1: the reload's payload. */
const WITHOUT_D1: DashboardPageData = {
  ...WITH_D1,
  status: { ...WITH_D1.status, kind: "none-today", doneToday: 0, totalToday: 0, loggedToday: 0 },
  done: [],
};

const REMOVED: ActionResult = {
  type: "success",
  status: 200,
  data: {
    success: true,
    doseId: "d1",
    restore: { deletedAt: "2026-05-01T14:00:05.000Z", expiresInMs: DOSE_UNDO_WINDOW_MS },
  },
};

const NOT_FOUND: ActionResult = {
  type: "failure",
  status: 404,
  data: { error: "Dose not found" },
};

const EDIT_D1 = "Edit: Metformin 500mg dose taken at 13:31";

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
/** The page's props. Replacing `data` is what the reload does. */
let props: { data: DashboardPageData & { user: typeof user; preferences: typeof preferences } };

function livePageProps(data: DashboardPageData) {
  const live = $state({ data: { ...data, user, preferences } });
  return live;
}

beforeEach(() => {
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  target = document.body.appendChild(document.createElement("div"));
  props = livePageProps(WITH_D1);
  app = mount(Page, {
    target,
    props,
    // The lock is the (app) layout's; the page reads it from context.
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

/** Let the Modal's own focus move (it runs a tick after it opens) land before the user acts. */
async function settle() {
  flushSync();
  for (let i = 0; i < 3; i++) await tick();
  flushSync();
}

/**
 * What a keyboard user does: focus Edit on d1's Done row, open the dialog,
 * and Tab to Remove this dose. Returns that button's form and its submit.
 */
async function focusRemoveInDialog() {
  const edit = buttonNamed(target, EDIT_D1);
  edit.focus();
  edit.click();
  await settle();
  const remove = buttonNamed(target, "Remove this dose");
  remove.focus();
  expect(document.activeElement, "Remove should hold focus").toBe(remove);
  const form = remove.closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("the dialog's Remove is not a use:enhance form");
  return { remove, form, submit };
}

describe("after the edit dialog's Remove this dose", () => {
  it("focus lands on the Done heading once the dose is gone and the dialog has closed over it", async () => {
    const { form, submit } = await focusRemoveInDialog();
    // The reload the write runs after the server answers: d1 is gone.
    h.invalidateAll.mockImplementationOnce(async () => {
      props.data = { ...WITHOUT_D1, user, preferences };
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, REMOVED).done;
    flushSync();

    expect(target.querySelector('[role="dialog"]'), "the dialog should close").toBeNull();
    expect(
      target.querySelector('[data-dose-id="d1"]'),
      "the reload should drop the row",
    ).toBeNull();
    const heading = document.getElementById("done-heading");
    expect(heading, "the Done heading is always rendered").not.toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("a failed Remove leaves the dialog open and focus on the Remove button", async () => {
    const { remove, form, submit } = await focusRemoveInDialog();

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, NOT_FOUND).done;
    flushSync();

    expect(h.showToast).toHaveBeenCalledWith("Dose not found", "error");
    expect(target.querySelector('[role="dialog"]'), "the dialog stays open").not.toBeNull();
    expect(document.activeElement).toBe(remove);
  });
});
