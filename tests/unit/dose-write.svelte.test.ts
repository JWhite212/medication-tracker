// createDoseWrite — the one client path for a dose write, on every page —
// driven through a bare control (helpers/DoseWriteProbe.svelte), really
// mounted, with its use:enhance callback driven by hand. DoseActionForm, the
// dashboard's markup over it, is in dose-action-form.test.ts; pressing an
// Undo is in undo-registry.test.ts; the reload's own rules are in
// reload-after-write.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
  invalidateAll: vi.fn(async () => {}),
  applyAction: vi.fn(async (_result: unknown) => {}),
  showToast: vi.fn(),
  navigating: { to: null, willUnload: null, complete: null } as {
    to: unknown;
    willUnload: boolean | null;
    complete: Promise<void> | null;
  },
  updated: { current: false },
  reloadDocumentIfUpdated: vi.fn(() => false),
}));

// The registry's offerUndo/withdrawUndoFor are no-ops unless `browser`.
vi.mock("$app/environment", () => ({ browser: true, dev: true, building: false, version: "test" }));
vi.mock("$app/forms", () => ({
  enhance: (form: HTMLFormElement, submit: SubmitFunction) => {
    h.submits.set(form, submit);
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
  applyAction: (result: unknown) => h.applyAction(result),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
// The real shape of $app/state's `navigating` and `updated` (kit
// src/runtime/app/state/client.js), mutated per test.
vi.mock("$app/state", () => ({ navigating: h.navigating, updated: h.updated, page: { data: {} } }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));
// The real reload, except the document reload: jsdom's location.reload cannot
// be observed. The stand-in answers from `updated.current`, as the real one
// does before it reloads.
vi.mock("$lib/components/dose-writes/reload-after-write", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/components/dose-writes/reload-after-write")>()),
  reloadDocumentIfUpdated: () => h.reloadDocumentIfUpdated(),
}));

import DoseWriteProbe from "./helpers/DoseWriteProbe.svelte";
import {
  OFFLINE_WRITE_TOAST,
  STILL_SAVING_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { HEALTH_PROBE_BACKOFF_MS } from "$lib/components/dose-writes/reload-after-write";
import {
  currentUndo,
  offerUndo,
  resetUndoRegistry,
  type UndoOfferInput,
} from "$lib/components/dose-writes/undo-registry.svelte";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

type ProbeProps = ComponentProps<typeof DoseWriteProbe>;

const SUCCESS: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
const DELETED: ActionResult = {
  type: "success",
  status: 200,
  data: {
    success: true,
    doseId: "d1",
    restore: { deletedAt: "2026-05-01T12:59:59.000Z", expiresInMs: 600_000 },
  },
};
const NOT_FOUND: ActionResult = {
  type: "failure",
  status: 404,
  data: { errors: { form: ["Medication not found"] } },
};
const CONFLICT: ActionResult = {
  type: "failure",
  status: 409,
  data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
};
const CRASH: ActionResult = {
  type: "error",
  status: 500,
  error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
};
/** What enhance builds when fetch itself rejects: no response, so no status. */
const LOST: ActionResult = { type: "error", error: new TypeError("Failed to fetch") };

/** An offer a previous delete of d1 left standing. */
const REMOVAL_OFFER: UndoOfferInput = {
  message: "Dose removed: Paracetamol 500mg at 8:00",
  doseId: "d1",
  kind: "restore",
  deletedAt: "2026-05-01T12:50:00.000Z",
  expiresInMs: 600_000,
  focusTarget: () => null,
};

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

const cleanups: Array<() => void> = [];

function mountProbe(opts: {
  lock: DoseWriteLock;
  props?: Partial<ProbeProps>;
  context?: Map<symbol, unknown>;
}) {
  const target = document.body.appendChild(document.createElement("div"));
  const component = mount(DoseWriteProbe, {
    target,
    props: opts.props ?? {},
    context: opts.context ?? doseWriteContext(opts.lock),
  });
  flushSync();
  cleanups.push(() => {
    unmount(component);
    target.remove();
  });
  const form = target.querySelector("form");
  const button = target.querySelector("button");
  if (!form || !button) throw new Error("DoseWriteProbe rendered no form or button");
  const submit = h.submits.get(form);
  if (!submit) throw new Error("use:enhance never attached");
  return { form, button, submit };
}

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.applyAction.mockReset();
  h.showToast.mockReset();
  Object.assign(h.navigating, { to: null, willUnload: null, complete: null });
  h.updated.current = false;
  h.reloadDocumentIfUpdated.mockReset();
  h.reloadDocumentIfUpdated.mockImplementation(() => h.updated.current);
});

afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  resetUndoRegistry();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "onLine");
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("createDoseWrite, before anything is sent", () => {
  it("offline at submit: cancels, says nothing was saved, and takes no lock", async () => {
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });
    setOnline(false);

    const { cancel, callback } = await startSubmit(submit, form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
    expect(lock.busy).toBe(false);
  });

  it("two controls under one layout share its lock: a write in one cancels the other's submit", async () => {
    const lock = createDoseWriteLock();
    const context = doseWriteContext(lock);
    const a = mountProbe({ lock, context });
    const b = mountProbe({
      lock,
      context,
      props: { fields: { medicationId: "m2", quantity: "1" } },
    });

    const first = await startSubmit(a.submit, a.form);
    const second = await startSubmit(b.submit, b.form);

    expect(first.callback).not.toBeNull();
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(second.callback).toBeNull();
  });

  it("a tap refused while another write is in flight says it is still saving; one refused in the cooldown alone says nothing", async () => {
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });

    lock.acquire(); // another write is in flight
    let tap = await startSubmit(submit, form);
    expect(tap.cancel).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error");

    lock.release(); // it settled; its cooldown is running
    h.showToast.mockClear();
    tap = await startSubmit(submit, form);
    expect(tap.cancel).toHaveBeenCalledOnce();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("with no staleGuard there is no stale check and no dashboard clock is needed — /log and /medications pass none", async () => {
    const lock = createDoseWriteLock();
    // doseWriteContext holds the lock only: there is no DASHBOARD_CLOCK.
    const { form, submit } = mountProbe({ lock, props: { options: {} } });

    const { cancel, callback } = await startSubmit(submit, form);

    expect(cancel).not.toHaveBeenCalled();
    expect(callback).not.toBeNull();
  });

  it("withdraws the Undo offer for its own dose once the write is sure to be sent — a refused write withdraws nothing", async () => {
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({
      lock,
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        options: { withdrawsUndoFor: "d1" },
      },
    });
    offerUndo(REMOVAL_OFFER);

    lock.acquire(); // refused: the user keeps their Undo
    await startSubmit(submit, form);
    expect(currentUndo()?.doseId).toBe("d1");

    lock.release();
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    const { callback } = await startSubmit(submit, form);
    expect(callback).not.toBeNull();
    expect(currentUndo()).toBeNull();
  });

  it("a held Enter fires once: the repeat is defaultPrevented, the first press is not", () => {
    const { button } = mountProbe({ lock: createDoseWriteLock() });
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

describe("createDoseWrite, on the result", () => {
  it("never calls update(): a failure posted to another route's action still toasts", async () => {
    // SvelteKit's update() applies a result only while the posting route is
    // the page on screen, and this page is not /dashboard.
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock, props: { action: "/dashboard?/logDose" } });

    for (const result of [SUCCESS, NOT_FOUND, CRASH]) {
      await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
      const { callback } = await startSubmit(submit, form);
      const { update, done } = finishSubmit(callback!, form, result);
      await done;
      expect(update).not.toHaveBeenCalled();
    }
    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
  });

  it("a delete's success offers Undo as a restore carrying the response's deletedAt and window", async () => {
    const focusTarget = () => null;
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        options: {
          undo: { kind: "restore", focusTarget },
          buildToast: () => "Dose removed: Paracetamol 500mg at 8:00",
        },
      },
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, DELETED).done;

    expect(currentUndo()).toMatchObject({
      kind: "restore",
      doseId: "d1",
      message: "Dose removed: Paracetamol 500mg at 8:00",
      deletedAt: "2026-05-01T12:59:59.000Z",
      expiresInMs: 600_000,
      focusTarget,
    });
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("a delete's offer deadline counts from the response, not from the end of a slow reload", async () => {
    // The reload can wait out a navigation, or an unreachable server, for as
    // long as it takes. The server's window started when it answered.
    h.invalidateAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    );
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: {
        action: "?/deleteDose",
        fields: { doseId: "d1" },
        options: { undo: { kind: "restore", focusTarget: () => null } },
      },
    });

    const { callback } = await startSubmit(submit, form);
    const t0 = Date.now(); // the response arrives now
    const { done } = finishSubmit(callback!, form, DELETED);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    // 30s inside the server's 600_000ms window, counted from t0, not t0 + 5s.
    expect(currentUndo()!.deadline).toBe(t0 + 600_000 - 30_000);
    // The window itself is passed through as the server sent it.
    expect(currentUndo()!.expiresInMs).toBe(600_000);
  });

  it("builds the toast with the time the response arrived, not the time a slow reload finished", async () => {
    h.invalidateAll.mockImplementationOnce(
      () => new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    );
    const buildToast = vi.fn(
      (_doseId: string | null, respondedAt: Date) => `Logged at ${respondedAt.toISOString()}`,
    );
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: { options: { buildToast } },
    });

    const { callback } = await startSubmit(submit, form);
    const t0 = Date.now(); // the response arrives now
    const { done } = finishSubmit(callback!, form, SUCCESS);
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(buildToast).toHaveBeenCalledWith("d-new", new Date(t0));
    expect(h.showToast).toHaveBeenCalledWith(`Logged at ${new Date(t0).toISOString()}`, "success");
  });

  it("a success with no Undo of its own shows a plain toast and clears the offer another write left", async () => {
    offerUndo(REMOVAL_OFFER);
    const { form, submit } = mountProbe({
      lock: createDoseWriteLock(),
      props: { options: { buildToast: () => "Metformin 500mg logged at 13:00" } },
    });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    expect(h.showToast).toHaveBeenCalledWith("Metformin 500mg logged at 13:00", "success");
    expect(currentUndo()).toBeNull();
  });

  it("after a 409 whose reload lost focus, focus goes to focusAfter; focus somewhere real is left alone", async () => {
    const heading = document.body.appendChild(document.createElement("h1"));
    heading.tabIndex = -1;
    const lock = createDoseWriteLock();
    const { form, button, submit } = mountProbe({
      lock,
      props: { options: { focusAfter: () => heading } },
    });

    // The reload removed what had focus: it fell to <body>.
    h.invalidateAll.mockImplementationOnce(async () => button.blur());
    button.focus();
    let { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, CONFLICT).done;
    expect(document.activeElement).toBe(heading);

    // Focus the user moved somewhere real during the request stays there.
    const search = document.body.appendChild(document.createElement("input"));
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    ({ callback } = await startSubmit(submit, form));
    search.focus();
    await finishSubmit(callback!, form, CONFLICT).done;
    expect(document.activeElement).toBe(search);
  });

  it("after a success, focus moves only if the reload lost it: focusAfter gets it from <body>; focus the user moved during the request stays", async () => {
    const heading = document.body.appendChild(document.createElement("h1"));
    heading.tabIndex = -1;
    const lock = createDoseWriteLock();
    const { form, button, submit } = mountProbe({
      lock,
      props: { options: { focusAfter: () => heading } },
    });

    // The reload removed what had focus: it fell to <body>.
    h.invalidateAll.mockImplementationOnce(async () => button.blur());
    button.focus();
    let { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;
    expect(document.activeElement).toBe(heading);

    // Focus the user moved somewhere real during the request stays there.
    const search = document.body.appendChild(document.createElement("input"));
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    ({ callback } = await startSubmit(submit, form));
    search.focus();
    await finishSubmit(callback!, form, SUCCESS).done;
    expect(document.activeElement).toBe(search);
  });

  it("after a success with no focusAfter, the control gets focus back only if the reload lost it", async () => {
    const lock = createDoseWriteLock();
    const { form, button, submit } = mountProbe({ lock });

    h.invalidateAll.mockImplementationOnce(async () => button.blur());
    button.focus();
    let { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;
    expect(document.activeElement).toBe(button);

    // The user tabbed on during the request: pulling them back would be the bug.
    const search = document.body.appendChild(document.createElement("input"));
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    button.focus();
    ({ callback } = await startSubmit(submit, form));
    search.focus();
    await finishSubmit(callback!, form, SUCCESS).done;
    expect(document.activeElement).toBe(search);
  });

  it("a 409 once a newer version is deployed reloads the document, not just the data", async () => {
    h.updated.current = true;
    const { form, submit } = mountProbe({ lock: createDoseWriteLock() });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, CONFLICT).done;

    expect(h.reloadDocumentIfUpdated).toHaveBeenCalledOnce();
    expect(h.invalidateAll).not.toHaveBeenCalled();
  });

  it("Review Focus #1: a request lost while online keeps the lock, probes /api/health, and reloads exactly once when it answers", async () => {
    const health = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 }) // the service worker's synthetic "Offline"
      .mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", health);
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });

    const { callback } = await startSubmit(submit, form);
    const { done } = finishSubmit(callback!, form, LOST);
    await flushMicrotasks();

    expect(h.showToast).toHaveBeenCalledWith(UNKNOWN_OUTCOME_TOAST, "error");
    expect(health).toHaveBeenCalledTimes(1);
    expect(health.mock.calls[0][0]).toBe("/api/health");
    expect(h.invalidateAll).not.toHaveBeenCalled();
    // The write may have landed. A retry now would act on data nobody has checked.
    expect(lock.active).toBe(true);

    await vi.advanceTimersByTimeAsync(HEALTH_PROBE_BACKOFF_MS[0]);
    await done;

    expect(health).toHaveBeenCalledTimes(2);
    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
    expect(lock.busy).toBe(true); // cooling down, as after any write
  });

  it("a request lost while offline reloads nothing until the connection is back", async () => {
    const health = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", health);
    const lock = createDoseWriteLock();
    const { form, submit } = mountProbe({ lock });

    const { callback } = await startSubmit(submit, form);
    setOnline(false);
    const { done } = finishSubmit(callback!, form, LOST);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(health).not.toHaveBeenCalled();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    expect(lock.active).toBe(true);

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    await done;

    expect(h.invalidateAll).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });

  it("a result that lands mid-navigation waits for the navigation to finish before reloading", async () => {
    const { form, submit } = mountProbe({ lock: createDoseWriteLock() });
    const { callback } = await startSubmit(submit, form);
    const navigation = deferred();
    Object.assign(h.navigating, {
      to: { url: new URL("http://localhost/log") },
      willUnload: false,
      complete: navigation.promise,
    });

    const { done } = finishSubmit(callback!, form, SUCCESS);
    await flushMicrotasks();
    // An invalidateAll now would abort the navigation the user started.
    expect(h.invalidateAll).not.toHaveBeenCalled();

    Object.assign(h.navigating, { to: null, willUnload: null, complete: null });
    navigation.resolve();
    await done;
    expect(h.invalidateAll).toHaveBeenCalledOnce();
  });

  it("applies a redirect", async () => {
    const redirect: ActionResult = { type: "redirect", status: 303, location: "/auth/login" };
    const { form, submit } = mountProbe({ lock: createDoseWriteLock() });

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, redirect).done;

    expect(h.applyAction).toHaveBeenCalledWith(redirect);
  });
});
