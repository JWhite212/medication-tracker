// Done's Remove and Remove skip are deletes, so each offers an Undo that
// restores the row: the offer carries the delete response's `restore`
// handle, and its focus target finds the restored row after the reload.
// Mounted for real (jsdom, client svelte) with the form's use:enhance
// callback driven by hand. Names and markup are in done-list-ssr.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";

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
// reloadAfterWrite reads both: no navigation in flight, no new deploy.
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
// The Undo registry is a no-op unless `browser`, like Toast's list.
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import DoneList, { restoredDoneRowFocus } from "$lib/components/dashboard/DoneList.svelte";
import { DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { accessibleName, buttonNamed } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T14:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const DELETED_AT = "2026-05-01T14:00:05.000Z";

function dose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  const takenAt = overrides.takenAt ?? new Date("2026-05-01T13:31:00.000Z");
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt,
    loggedAt: takenAt,
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: takenAt,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

const TAKEN: DoneRow = { key: "d1", dose: dose({ id: "d1" }), covers: [], dayLabel: null };
const SKIPPED: DoneRow = {
  key: "d2",
  dose: dose({ id: "d2", status: "skipped", takenAt: new Date("2026-05-01T11:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};
const MISSED: DoneRow = {
  key: "d3",
  dose: dose({ id: "d3", status: "missed", takenAt: new Date("2026-05-01T12:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};

/** The dashboard delete action's success: the dose id and its restore handle. */
function removed(doseId: string): ActionResult {
  return {
    type: "success",
    status: 200,
    data: {
      success: true,
      doseId,
      restore: { deletedAt: DELETED_AT, expiresInMs: DOSE_UNDO_WINDOW_MS },
    },
  };
}

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  target = document.body.appendChild(document.createElement("div"));
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  resetUndoRegistry();
});

function mountList(rows: DoneRow[] = [TAKEN, SKIPPED, MISSED]) {
  app = mount(DoneList, {
    target,
    props: {
      rows,
      title: "Done today",
      todayStart: TODAY_START,
      timezone: "UTC",
      timeFormat: "24h",
      onedit: () => {},
    },
    context: dashboardContext({ now: NOW }),
  });
  flushSync();
}

function removeForm(name: string) {
  const form = buttonNamed(target, name).closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error(`"${name}" is not a use:enhance form`);
  return { form, submit };
}

/** Submit a row's remove form and settle it with `result`, as SvelteKit would. */
async function remove(name: string, result: ActionResult) {
  const { form, submit } = removeForm(name);
  const { callback } = await startSubmit(submit, form);
  expect(callback, "the remove was refused").not.toBeNull();
  await finishSubmit(callback!, form, result).done;
  flushSync();
  return form;
}

describe("Done's Remove skip and Remove offer a restore Undo", () => {
  it("Remove skip posts the dose id to ?/deleteDose and offers an Undo carrying the restore handle", async () => {
    mountList();
    const form = await remove("Remove skip: Metformin 500mg, skipped at 11:00", removed("d2"));

    expect(form.getAttribute("action")).toBe("?/deleteDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({ doseId: "d2" });
    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d2",
      deletedAt: DELETED_AT,
      expiresInMs: DOSE_UNDO_WINDOW_MS,
      message: "Metformin 500mg: skip removed",
    });
    // The offer is the confirmation; the same sentence is not toasted twice.
    expect(h.showToast).not.toHaveBeenCalledWith("Metformin 500mg: skip removed", "success");
  });

  it("Remove on a missed entry says so, with the same kind of Undo", async () => {
    mountList();
    await remove("Remove: Metformin 500mg, missed at 12:00", removed("d3"));

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d3",
      deletedAt: DELETED_AT,
      message: "Metformin 500mg: missed entry removed",
    });
  });

  it("withdraws an Undo that names the same dose as soon as the remove is sent", async () => {
    // The Skip's own Undo would delete this row; once Remove skip is on its
    // way that Undo acts on nothing.
    mountList();
    offerUndo({
      message: "Metformin 500mg: 11:00 dose skipped",
      doseId: "d2",
      kind: "delete",
      focusTarget: () => null,
    });
    expect(currentUndo()?.doseId).toBe("d2");

    const { form, submit } = removeForm("Remove skip: Metformin 500mg, skipped at 11:00");
    const { callback } = await startSubmit(submit, form);

    expect(callback).not.toBeNull();
    expect(currentUndo()).toBeNull();
  });
});

describe("restoredDoneRowFocus: where focus goes once an Undo has restored a Done row", () => {
  it("is the restored row's Edit when it has one", () => {
    mountList();
    expect(restoredDoneRowFocus("d1")()).toBe(
      buttonNamed(target, "Edit: Metformin 500mg dose taken at 13:31"),
    );
  });

  it("is the Done heading for a restored skip or missed entry, never its Remove", () => {
    mountList();
    const heading = document.getElementById(DONE_HEADING_ID);
    for (const id of ["d2", "d3"]) {
      const focus = restoredDoneRowFocus(id)();
      expect(focus, id).toBe(heading);
      expect(accessibleName(focus!), id).not.toMatch(/^Remove/);
    }
  });

  it("is the Done heading when the row is not on the page", () => {
    mountList([TAKEN]);
    expect(restoredDoneRowFocus("d9")()).toBe(document.getElementById(DONE_HEADING_ID));
  });

  it("is the target Remove skip's offer focuses", async () => {
    mountList();
    await remove("Remove skip: Metformin 500mg, skipped at 11:00", removed("d2"));
    // invalidateAll is inert here, so the row is still rendered: the page as
    // the restore's reload leaves it.
    expect(currentUndo()!.focusTarget()).toBe(document.getElementById(DONE_HEADING_ID));
  });
});
