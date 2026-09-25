// DoseActionForm is the ONE use:enhance for every dashboard log, skip, undo
// and remove. These drive its callback by hand against a really mounted
// component. SSR markup (names, fields, sizes) is in due-card-ssr.test.ts;
// the 'error' ordering is in dose-write-lock.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submit: null as SubmitFunction | null,
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";
import type { DashboardClock } from "$lib/components/dashboard/dashboard-clock";
import {
  NETWORK_FAILURE_TOAST,
  STALE_TAP_MESSAGE,
  SUCCESS_FALLBACK_TOAST,
  UNDO_ACTION,
  UNDONE_TOAST,
} from "$lib/components/dashboard/dose-action";
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
});

describe("DoseActionForm submit", () => {
  it("cancels a submit while the lock is busy, with no toast and no request", async () => {
    const { lock, form, submit } = setup();
    lock.acquire();
    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("refuses a tap on an expired list: cancels, reloads, says so, and stays locked until the reload lands", async () => {
    const reload = deferred();
    const refresh = vi.fn(() => reload.promise);
    const { lock, form, submit } = setup({ clock: { nextRefreshAt: () => NOW, refresh } });

    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(STALE_TAP_MESSAGE, "error");

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
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

  it("on success: reloads first, then toasts from the reloaded data with an Undo, then focuses, then calls onSuccess", async () => {
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
    const { lock, form, submit } = setup({
      props: { buildToast, undoable: true, focusAfter, onSuccess },
    });

    const { callback } = await startSubmit(submit, form);
    const update = vi.fn(async () => {
      order.push("update");
    });
    await finishSubmit(callback!, form, SUCCESS, update).done;

    expect(order).toEqual(["update", "toast:d-new", "focus", "onSuccess"]);
    expect(h.showToast).toHaveBeenCalledWith(
      "Metformin 500mg logged at 13:00",
      "success",
      expect.any(Function),
    );
    expect(document.activeElement).toBe(target);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
    target.remove();
  });

  it("with no focusAfter, a chip keeps focus through the reload's focus reset", async () => {
    // For a success, SvelteKit's applyAction resets focus to <body>. A chip
    // has nowhere better to send focus than itself, so it takes it back, or
    // the next Tab after every keyboard log starts from the top of the page.
    const { form, button, submit } = setup({ props: { variant: "chip", quickLog: true } });
    button.focus();
    const { callback } = await startSubmit(submit, form);
    const update = vi.fn(async () => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute("tabindex");
    });

    await finishSubmit(callback!, form, SUCCESS, update).done;

    expect(update).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(button);
  });

  it("still toasts when the reload itself fails — the write did not", async () => {
    const buildToast = vi.fn(() => "Metformin 500mg logged at 13:00");
    const { form, submit } = setup({ props: { buildToast } });
    const { callback } = await startSubmit(submit, form);
    const update = vi.fn(async () => {
      throw new Error("load failed");
    });
    await finishSubmit(callback!, form, SUCCESS, update).done;
    expect(buildToast).toHaveBeenCalledWith("d-new");
    expect(h.showToast).toHaveBeenCalledWith(
      "Metformin 500mg logged at 13:00",
      "success",
      undefined,
    );
  });

  it("falls back to a plain toast with no Undo when there is no builder or no doseId", async () => {
    const { form, submit } = setup({ props: { undoable: true } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "success", status: 200, data: { success: true } })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(SUCCESS_FALLBACK_TOAST, "success", undefined);
  });

  it("Undo posts the doseId to the absolute deleteDose action, then reloads", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      text: async () => JSON.stringify({ type: "success", status: 200 }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { form, submit } = setup({ props: { buildToast: () => "logged", undoable: true } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    const undo = h.showToast.mock.calls[0][2] as () => void;
    h.invalidateAll.mockClear();
    undo();

    await vi.waitFor(() => expect(h.invalidateAll).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(UNDO_ACTION);
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("doseId")).toBe("d-new");
    expect(h.showToast).toHaveBeenLastCalledWith(UNDONE_TOAST, "success");
  });

  it("holds the lock across Undo's fetch and reload — even over the write it undoes still cooling down — then cools down again", async () => {
    const fetchStarted = deferred();
    const fetchMock = vi.fn(async () => {
      await fetchStarted.promise;
      return { text: async () => JSON.stringify({ type: "success", status: 200 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { lock, form, submit } = setup({ props: { buildToast: () => "logged", undoable: true } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    // The write Undo is about to reverse is still cooling down, with 50ms of
    // its 700ms left: it must not be refused by that, and its own reload
    // must not inherit that shorter deadline.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS - 50);
    expect(lock.busy).toBe(true);

    const undo = h.showToast.mock.calls[0][2] as () => void;
    const invalidateAllDone = deferred();
    h.invalidateAll.mockReset();
    h.invalidateAll.mockImplementation(() => invalidateAllDone.promise);
    undo();
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // mid-fetch

    // Past where the original write's own cooldown would have expired
    // (50ms remained above): a lock that only inherited it would be free by now.
    await vi.advanceTimersByTimeAsync(100);
    expect(lock.busy).toBe(true);

    fetchStarted.resolve();
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // fetch settled, reload (invalidateAll) still pending

    invalidateAllDone.resolve();
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // reload landed; now cooling down fresh

    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
  });

  it("keeps Undo's hold exclusive: an unrelated write's own release() must not end it early", async () => {
    // The write whose toast carries the Undo.
    const first = setup({ props: { buildToast: () => "logged", undoable: true } });
    const { lock } = first;
    const { callback: firstCallback } = await startSubmit(first.submit, first.form);
    await finishSubmit(firstCallback!, first.form, SUCCESS).done;
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false); // the first write has fully settled and cooled down
    const undo = h.showToast.mock.calls[0][2] as () => void;

    // A second, unrelated write on the same page: it takes the lock via acquire().
    const second = mountDoseActionForm({ lock, clock: fixedClock(NOW) });
    const secondSubmit = h.submit!;
    const { callback: secondCallback } = await startSubmit(secondSubmit, second.form);
    expect(lock.busy).toBe(true);

    // While that second write is still in flight, Undo is tapped on the
    // first toast — the Undo button has no lock gating, so this is allowed
    // to overlap with any other write.
    const fetchStarted = deferred();
    const fetchMock = vi.fn(async () => {
      await fetchStarted.promise;
      return { text: async () => JSON.stringify({ type: "success", status: 200 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const invalidateAllDone = deferred();
    h.invalidateAll.mockReset();
    h.invalidateAll.mockImplementation(() => invalidateAllDone.promise);
    undo();
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // Undo's fetch in flight

    // The unrelated second write settles and calls its own release() —
    // this is the exact interference the finding describes, and must not
    // free the page while Undo's fetch/reload is still outstanding.
    await finishSubmit(secondCallback!, second.form, SUCCESS).done;
    expect(lock.busy).toBe(true);

    // Outlast the cooldown a lock that (wrongly) timed itself from the
    // second write's own completion would already have expired by — while
    // Undo's fetch/reload is still pending, the lock must still be busy.
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(true);

    fetchStarted.resolve();
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // fetch settled, Undo's own reload still pending

    invalidateAllDone.resolve();
    await flushMicrotasks();
    expect(lock.busy).toBe(true); // Undo's reload landed; now cooling down fresh

    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);

    second.destroy();
  });

  it("a 409 reloads before releasing the lock, and never runs update()", async () => {
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

  it("a network failure says to check Done before retrying, not the browser's own text", async () => {
    // The write may or may not have landed, and a chip retry would log a
    // second dose.
    const { form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "error", error: new TypeError("Failed to fetch") })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(NETWORK_FAILURE_TOAST, "error");
  });

  it("Undo that cannot reach the server says so in the same words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Load failed");
      }),
    );
    const { form, submit } = setup({ props: { buildToast: () => "logged", undoable: true } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    const undo = h.showToast.mock.calls[0][2] as () => void;
    h.invalidateAll.mockClear();
    undo();

    await vi.waitFor(() => expect(h.invalidateAll).toHaveBeenCalledOnce());
    expect(h.showToast).toHaveBeenLastCalledWith(NETWORK_FAILURE_TOAST, "error");
  });

  it("any other failure runs update() and releases, without a reload", async () => {
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
    await done;
    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
    expect(update).toHaveBeenCalledOnce();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });
});
