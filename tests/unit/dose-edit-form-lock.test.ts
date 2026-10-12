// DoseEditForm keeps its own use:enhance, for its inline field errors, but a
// Save is a dose write: it takes the (app) layout's write lock, refuses to
// run offline, withdraws and clears Undo offers, and reloads through
// reloadAfterWrite(), never update(). Mounted for real (jsdom, client svelte)
// with each form's use:enhance callback driven by hand. How each failure is
// SHOWN (field messages, the in-dialog alert) is in
// form-errors-enhance-callbacks.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import type { DoseLogWithMedication } from "$lib/types";

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

import DoseEditForm from "$lib/components/DoseEditForm.svelte";
import DoseActionForm from "$lib/components/dashboard/DoseActionForm.svelte";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import {
  OFFLINE_WRITE_TOAST,
  STILL_SAVING_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

const DOSE: DoseLogWithMedication = {
  id: "d1",
  userId: "u1",
  medicationId: "m1",
  quantity: 1,
  takenAt: new Date("2026-05-01T09:00:00.000Z"),
  loggedAt: new Date("2026-05-01T09:00:00.000Z"),
  notes: null,
  sideEffects: null,
  status: "taken",
  updatedAt: new Date("2026-05-01T09:00:00.000Z"),
  medication: {
    name: "Ibuprofen",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
  },
};

const SAVED: ActionResult = { type: "success", status: 200, data: { success: true } };
// What `enhance` builds when `fetch` itself rejects: no response, no status.
const NO_RESPONSE = { type: "error", error: new TypeError("Failed to fetch") } as ActionResult;

let lock: DoseWriteLock;
let onclose: Mock<() => void>;
let teardown: Array<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
  lock = createDoseWriteLock();
  onclose = vi.fn();
  teardown = [];
});

afterEach(() => {
  for (const fn of teardown) fn();
  resetUndoRegistry();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A fresh host element, removed again (with whatever was mounted in it) after the test. */
function host(): HTMLElement {
  return document.body.appendChild(document.createElement("div"));
}

function track(target: HTMLElement, app: ReturnType<typeof mount>): void {
  flushSync();
  teardown.push(() => {
    unmount(app);
    target.remove();
  });
}

function enhanced(form: HTMLFormElement | null) {
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error("no use:enhance form");
  return { form, submit };
}

function mountEditForm() {
  const target = host();
  track(
    target,
    mount(DoseEditForm, {
      target,
      props: { dose: DOSE, timezone: "UTC", onclose },
      context: dashboardContext({ lock }),
    }),
  );
  const save = target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  return { save, ...enhanced(target.querySelector<HTMLFormElement>('form[action="?/editDose"]')) };
}

/** The dialog's Remove, as the dashboard renders it beside the edit form, under the same lock. */
function mountRemove() {
  const target = host();
  track(
    target,
    mount(DoseActionForm, {
      target,
      props: {
        action: "?/deleteDose",
        fields: { doseId: DOSE.id },
        label: "Remove this dose",
        pendingLabel: "Removing…",
        variant: "danger",
      },
      context: dashboardContext({ lock }),
    }),
  );
  return enhanced(target.querySelector("form"));
}

function offerFor(doseId: string): void {
  offerUndo({
    message: `Dose removed: ${doseId}`,
    doseId,
    kind: "restore",
    deletedAt: "2026-05-01T09:05:00.000Z",
    expiresInMs: DOSE_UNDO_WINDOW_MS,
    focusTarget: () => null,
  });
  expect(currentUndo()?.doseId).toBe(doseId);
}

describe("DoseEditForm under the layout's write lock", () => {
  it("cancels a Save while another dose write holds the lock, and says so only while one is in flight", async () => {
    const { form, submit, save } = mountEditForm();

    lock.acquire();
    const busy = await startSubmit(submit, form);
    expect(busy.cancel).toHaveBeenCalledOnce();
    expect(busy.callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error", { coalesce: true });
    flushSync();
    expect(save.textContent?.trim()).toBe("Save Changes");

    // The write has let go and only its cooldown remains: refused silently.
    lock.release();
    h.showToast.mockClear();
    const cooling = await startSubmit(submit, form);
    expect(cooling.cancel).toHaveBeenCalledOnce();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("cancels the dialog's Remove while a Save is in flight, and frees both once it settles", async () => {
    const edit = mountEditForm();
    const remove = mountRemove();

    const saving = await startSubmit(edit.submit, edit.form);
    expect(saving.cancel).not.toHaveBeenCalled();

    const removing = await startSubmit(remove.submit, remove.form);
    expect(removing.cancel).toHaveBeenCalledOnce();
    expect(removing.callback).toBeNull();

    await finishSubmit(saving.callback!, edit.form, SAVED).done;
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);

    const retry = await startSubmit(remove.submit, remove.form);
    expect(retry.cancel).not.toHaveBeenCalled();
  });

  it("is aria-disabled, never disabled, while any dose write holds the lock, and 44px tall", () => {
    const { save } = mountEditForm();
    expect(save.hasAttribute("aria-disabled")).toBe(false);
    expect([...save.classList]).toContain("min-h-11");

    lock.acquire();
    flushSync();
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(save.disabled).toBe(false);
  });

  it("offline, cancels the Save, says nothing was saved, and takes no lock", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { form, submit } = mountEditForm();

    const { cancel, callback } = await startSubmit(submit, form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
    expect(lock.busy).toBe(false);
  });
});

describe("DoseEditForm and the Undo offer", () => {
  it("withdraws an offer naming this dose once the Save is sent, and a refused Save withdraws nothing", async () => {
    const { form, submit } = mountEditForm();
    offerFor("d1");

    lock.acquire();
    await startSubmit(submit, form);
    expect(currentUndo()?.doseId, "a refused Save must keep the Undo").toBe("d1");

    lock.release();
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    const sent = await startSubmit(submit, form);
    expect(sent.cancel).not.toHaveBeenCalled();
    expect(currentUndo()).toBeNull();
  });

  it("clears whatever offer remains after a successful Save, even one naming another dose", async () => {
    // An edit can move a dose onto a deleted one's slot; restoring that one
    // afterwards would record two doses for one slot.
    const { form, submit } = mountEditForm();
    offerFor("d9");

    const { callback } = await startSubmit(submit, form);
    expect(currentUndo()?.doseId, "the submit withdraws only this dose's offer").toBe("d9");

    const { update, done } = finishSubmit(callback!, form, SAVED);
    await done;

    expect(currentUndo()).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith("Dose updated", "success");
    expect(onclose).toHaveBeenCalledOnce();
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });
});

describe("DoseEditForm when the outcome is unknown", () => {
  it("keeps the lock until the server answers, then reloads exactly once and lets go", async () => {
    let answer!: (response: { ok: boolean }) => void;
    const probe = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => (answer = resolve)));
    vi.stubGlobal("fetch", probe);
    const { form, submit } = mountEditForm();

    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, NO_RESPONSE);

    await vi.waitFor(() =>
      expect(probe).toHaveBeenCalledWith("/api/health", { cache: "no-store" }),
    );
    expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
    expect(lock.active, "a retry must not run against unchecked data").toBe(true);
    expect(h.invalidateAll).not.toHaveBeenCalled();

    answer({ ok: true });
    await done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});

/**
 * Signing out unmounts the (app) layout, and its onDestroy calls
 * resetUndoRegistry(). A Save whose response lands after that belongs to the
 * previous person: no toast, no dialog closing, no reload, no focus move —
 * only the lock goes.
 */
describe("DoseEditForm after the (app) layout has gone (a sign-out)", () => {
  function signOut() {
    resetUndoRegistry();
    for (const fn of teardown.splice(0)) fn();
  }

  it.each<[string, ActionResult]>([
    ["a success", SAVED],
    ["a refusal", { type: "failure", status: 404, data: { error: "Dose not found" } }],
    ["a crash", { type: "error", status: 500, error: { message: "Something went wrong" } }],
  ])("%s landing after sign-out shows nothing and lets go of the lock", async (_name, result) => {
    const { form, submit } = mountEditForm();
    const { callback } = await startSubmit(submit, form);

    signOut();
    await finishSubmit(callback!, form, result).done;

    expect(h.showToast).not.toHaveBeenCalled();
    expect(onclose).not.toHaveBeenCalled();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });

  it("an unknown outcome, then a sign-out: it stops probing /api/health and reloads nothing", async () => {
    const probe = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", probe);
    const { form, submit } = mountEditForm();
    const { callback } = await startSubmit(submit, form);
    const { done } = finishSubmit(callback!, form, NO_RESPONSE);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());

    signOut();
    await vi.advanceTimersByTimeAsync(60_000);
    await done;

    expect(probe).toHaveBeenCalledOnce();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });

  it("a success that lands during the sign-out navigation reloads nothing once it has finished", async () => {
    const { navigating } = (await import("$app/state")) as unknown as {
      navigating: { to: unknown; willUnload: boolean | null; complete: Promise<void> | null };
    };
    const { form, submit } = mountEditForm();
    const { callback } = await startSubmit(submit, form);
    let finishNavigation!: () => void;
    Object.assign(navigating, {
      to: { url: new URL("http://localhost/auth/login") },
      willUnload: false,
      complete: new Promise<void>((resolve) => (finishNavigation = resolve)),
    });

    const { done } = finishSubmit(callback!, form, SAVED);
    await vi.advanceTimersByTimeAsync(0);
    // The navigation leaves (app): the layout unmounts, then it completes.
    resetUndoRegistry();
    Object.assign(navigating, { to: null, willUnload: null, complete: null });
    finishNavigation();
    await done;

    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });

  it("a refusal whose sign-out lands while its message takes focus reloads nothing", async () => {
    const { form, submit } = mountEditForm();
    const { callback } = await startSubmit(submit, form);
    // The sign-out completes during the tick focusFirstProblem waits.
    queueMicrotask(() => resetUndoRegistry());

    await finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { error: "Dose not found" },
    }).done;

    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(lock.active).toBe(false);
  });
});
