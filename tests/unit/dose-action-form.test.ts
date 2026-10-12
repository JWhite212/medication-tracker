// DoseActionForm is the dashboard's markup over createDoseWrite
// (dose-writes/dose-write.svelte.ts). These drive its use:enhance callback by
// hand against a really mounted component, for what DoseActionForm itself
// decides: its markup, that it passes the dashboard clock as the stale guard,
// its card's aria-busy, and that its props reach the primitive. The
// primitive's own rules are in dose-write.svelte.test.ts, pressing an Undo in
// undo-registry.test.ts, SSR markup in due-card-ssr.test.ts, and the 'error'
// ordering in dose-write-lock.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submit: null as SubmitFunction | null,
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: async () => {},
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$app/state", () => ({
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
  page: { data: {} },
}));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import type { DashboardClock } from "$lib/components/dashboard/dashboard-clock";
import {
  DELETE_ACTION,
  STALE_TAP_MESSAGE,
  STILL_SAVING_TOAST,
  SUCCESS_FALLBACK_TOAST,
  UNDONE_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
  runUndo,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { fixedClock } from "./helpers/dashboard-context";
import {
  finishSubmit,
  mountDoseActionForm,
  startSubmit,
  type DoseActionFormProps,
} from "./helpers/dose-action-form-harness";
import { accessibleName } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const SUCCESS = { type: "success", status: 200, data: { success: true, doseId: "d-new" } } as const;
/** A create's Undo: it deletes the new dose. */
const CREATE_UNDO = { kind: "delete", focusTarget: () => null } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

let destroy: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
});

afterEach(() => {
  destroy?.();
  destroy = null;
  resetUndoRegistry();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(
  opts: {
    props?: Partial<DoseActionFormProps>;
    clock?: Partial<DashboardClock>;
    insideCard?: boolean;
  } = {},
) {
  const lock = createDoseWriteLock();
  const mounted = mountDoseActionForm({
    lock,
    clock: fixedClock(NOW, opts.clock),
    props: opts.props,
    insideCard: opts.insideCard,
  });
  destroy = mounted.destroy;
  const submit = h.submit;
  if (!submit) throw new Error("use:enhance never attached");
  return { lock, submit, ...mounted };
}

describe("DoseActionForm markup", () => {
  it("posts its fields as hidden inputs to its action", () => {
    const { form } = setup();
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-05-01T13:30:00.000Z",
    });
  });

  it("names the button by its visible label first, then the screen-reader context", () => {
    const { button } = setup();
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(accessibleName(button)).toBe("Log now: Metformin 500mg, 13:30 dose");
  });

  it("renders children before the label, which is how a chip gets its sr-only 'Log '", () => {
    const { button, form } = setup({
      props: {
        variant: "chip",
        label: "Ibuprofen 200mg ×2",
        srContext: undefined,
        quickLog: true,
        children: createRawSnippet(() => ({ render: () => `<span class="sr-only">Log </span>` })),
      },
    });
    expect(accessibleName(button)).toBe("Log Ibuprofen 200mg ×2");
    expect(form.hasAttribute("data-quick-log")).toBe(true);
  });

  it("marks only quick-log forms with data-quick-log", () => {
    expect(setup().form.hasAttribute("data-quick-log")).toBe(false);
  });

  it("is aria-disabled — never disabled — while any dose write holds the lock", () => {
    const { lock, button } = setup();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    lock.acquire();
    flushSync();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
  });

  it("gives chip and danger their own fixed-height recipes", () => {
    const chip = setup({ props: { variant: "chip" } }).button;
    expect([...chip.classList]).toEqual(expect.arrayContaining(["h-11", "rounded-full"]));
    destroy?.();
    const danger = setup({ props: { variant: "danger" } }).button;
    expect([...danger.classList]).toEqual(expect.arrayContaining(["min-h-11", "text-danger-ink"]));
  });

  it("ignores a held Enter: the repeat is defaultPrevented, the first press is not", () => {
    const { button } = setup();
    const first = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const held = new KeyboardEvent("keydown", {
      key: "Enter",
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(first);
    button.dispatchEvent(held);
    expect(first.defaultPrevented).toBe(false);
    expect(held.defaultPrevented).toBe(true);
  });
});

describe("DoseActionForm submit", () => {
  it("refuses a tap while another dose write is in flight, and says it is still saving", async () => {
    const { lock, form, submit } = setup();
    lock.acquire();
    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error");
  });

  it("refuses a tap during the cooldown silently, with no request", async () => {
    const { lock, form, submit } = setup();
    lock.acquire();
    lock.release();
    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("refuses a tap on an expired list: cancels, says so, reloads, and stays locked until the reload lands", async () => {
    const reload = deferred();
    h.invalidateAll.mockImplementation(() => reload.promise);
    const { lock, form, submit } = setup({ clock: { isExpired: () => true } });

    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(STALE_TAP_MESSAGE, "error");

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.busy).toBe(true);

    reload.resolve();
    await flushMicrotasks();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("shows the pending label and marks its card aria-busy until the write settles", async () => {
    const { host, form, button, submit } = setup({ insideCard: true });
    const label = button.querySelector('[data-part="label"]');
    const pending = button.querySelector('[data-part="pending"]');
    expect(pending?.getAttribute("aria-hidden")).toBe("true");

    const { callback } = await startSubmit(submit, form);
    flushSync();
    expect(host.getAttribute("aria-busy")).toBe("true");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    expect(pending?.getAttribute("aria-hidden")).toBeNull();
    expect(pending?.textContent).toContain("Logging…");

    await finishSubmit(callback!, form, SUCCESS).done;
    flushSync();
    expect(host.hasAttribute("aria-busy")).toBe(false);
    expect(pending?.getAttribute("aria-hidden")).toBe("true");
  });

  it("on success: reloads first, then offers Undo built from the reloaded data, then calls onSuccess, then focuses", async () => {
    const order: string[] = [];
    const target = document.createElement("h1");
    target.tabIndex = -1;
    document.body.append(target);
    const buildToast = vi.fn((doseId: string | null) => {
      order.push(`toast:${doseId}`);
      return "Metformin 500mg logged at 13:00";
    });
    const focusAfter = vi.fn(() => {
      order.push("focus");
      return target;
    });
    const onSuccess = vi.fn(() => {
      order.push("onSuccess");
    });
    // The reload takes time. Everything after it must wait for it to land,
    // or the builder reads the old page data and drops what the reload says.
    const reload = deferred();
    h.invalidateAll.mockImplementation(async () => {
      order.push("reload:start");
      await reload.promise;
      order.push("reload:done");
    });
    const { lock, form, submit } = setup({
      props: { buildToast, undo: CREATE_UNDO, focusAfter, onSuccess },
    });

    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, SUCCESS);
    await flushMicrotasks();
    expect(order).toEqual(["reload:start"]);

    reload.resolve();
    await done;

    // onSuccess before focus: it can close a dialog over the control that held
    // focus, and focus is judged only once that has happened (the dashboard
    // page's Remove test: dashboard-remove-focus.svelte.test.ts).
    expect(order).toEqual(["reload:start", "reload:done", "toast:d-new", "onSuccess", "focus"]);
    expect(currentUndo()).toMatchObject({
      message: "Metformin 500mg logged at 13:00",
      doseId: "d-new",
      kind: "delete",
    });
    expect(h.showToast).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("with no focusAfter, a chip keeps focus through the reload", async () => {
    // The reload can re-render focus away; a chip has nowhere better to send
    // it than itself, or the next Tab after every keyboard log starts from
    // the top of the page.
    const { form, button, submit } = setup({ props: { variant: "chip", quickLog: true } });
    button.focus();
    h.invalidateAll.mockImplementationOnce(async () => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
  });

  it("still toasts when the reload itself fails — the write did not", async () => {
    h.invalidateAll.mockRejectedValueOnce(new Error("load failed"));
    const buildToast = vi.fn(() => "Metformin 500mg logged at 13:00");
    const { form, submit } = setup({ props: { buildToast } });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    // The second argument is when the response arrived; dose-write.svelte.test.ts pins it.
    expect(buildToast).toHaveBeenCalledWith("d-new", expect.any(Date));
    expect(h.showToast).toHaveBeenCalledWith("Metformin 500mg logged at 13:00", "success");
  });

  it("falls back to a plain 'Saved' toast, with no offer, when there is no builder or no doseId", async () => {
    const { form, submit } = setup({ props: { undo: CREATE_UNDO } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "success", status: 200, data: { success: true } })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(SUCCESS_FALLBACK_TOAST, "success");
    expect(currentUndo()).toBeNull();
  });

  it("its create's Undo, pressed, posts the doseId and forUndo=1 to the absolute deleteDose action", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      status: 200,
      text: async () =>
        JSON.stringify({ type: "success", status: 200, data: { success: true, doseId: "d-new" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { lock, form, submit } = setup({
      props: { buildToast: () => "logged", undo: CREATE_UNDO },
    });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    const outcome = await runUndo(lock);

    expect(outcome).toEqual({ kind: "settled", message: UNDONE_TOAST, type: "success" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DELETE_ACTION);
    expect((init?.body as FormData).get("doseId")).toBe("d-new");
    expect((init?.body as FormData).get("forUndo")).toBe("1");
  });

  it("a Remove withdraws its dose's offer when sent, and offers a restore with the response's handle", async () => {
    const { form, submit } = setup({
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        label: "Remove this dose",
        srContext: undefined,
        pendingLabel: "Removing…",
        variant: "danger",
        buildToast: () => "Dose removed: Paracetamol 500mg at 8:00",
        undo: { kind: "restore", focusTarget: () => null },
        withdrawsUndoFor: "d1",
      },
    });
    // The offer from logging this dose a moment ago.
    offerUndo({
      message: "Paracetamol 500mg logged at 8:00",
      doseId: "d1",
      kind: "delete",
      focusTarget: () => null,
    });

    const { callback } = await startSubmit(submit, form);
    expect(currentUndo()).toBeNull();

    await finishSubmit(callback!, form, {
      type: "success",
      status: 200,
      data: {
        success: true,
        doseId: "d1",
        restore: { deletedAt: "2026-05-01T12:59:59.000Z", expiresInMs: 600_000 },
      },
    }).done;

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      message: "Dose removed: Paracetamol 500mg at 8:00",
      deletedAt: "2026-05-01T12:59:59.000Z",
      expiresInMs: 600_000,
    });
  });

  it("a 409 toasts, reloads before releasing the lock, and never runs update()", async () => {
    const reload = deferred();
    h.invalidateAll.mockImplementation(() => reload.promise);
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });

    expect(h.showToast).toHaveBeenCalledWith(
      "What's due has changed. Refresh to see what's due now.",
      "error",
    );
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(lock.busy).toBe(true);
    expect(update).not.toHaveBeenCalled();

    reload.resolve();
    await done;
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("a network failure says the outcome is unknown and the page will update — not the browser's words", async () => {
    // The server answers the reachability probe at once.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 })),
    );
    const { form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "error", error: new TypeError("Failed to fetch") })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("any other failure toasts and reloads before releasing the lock too, and never runs update()", async () => {
    // A 404 means the page shows something that is gone: until the reload
    // lands, a second tap would get the same refusal.
    const reload = deferred();
    h.invalidateAll.mockImplementation(() => reload.promise);
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.busy).toBe(true);
    expect(update).not.toHaveBeenCalled();

    reload.resolve();
    await done;
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });
});
