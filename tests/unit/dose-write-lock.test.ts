// The dashboard's page-wide dose-write lock, and the DoseActionForm path whose
// ORDERING matters most: an 'error' result means the outcome is unknown, so
// the page must not accept another tap until the reload has landed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { fixedClock } from "./helpers/dashboard-context";
import { finishSubmit, mountDoseActionForm, startSubmit } from "./helpers/dose-action-form-harness";

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDoseWriteLock", () => {
  it("cools down for 700ms by default", () => {
    expect(DOSE_WRITE_COOLDOWN_MS).toBe(700);
  });

  it("grants the lock once and refuses it while it is held", () => {
    const lock = createDoseWriteLock();
    expect(lock.busy).toBe(false);
    expect(lock.acquire()).toBe(true);
    expect(lock.busy).toBe(true);
    expect(lock.acquire()).toBe(false);
  });

  it("stays busy through the whole cooldown after release, to the millisecond", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();

    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    expect(lock.acquire()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
    expect(lock.acquire()).toBe(true);
  });

  it("honours a custom cooldown", () => {
    const lock = createDoseWriteLock({ cooldownMs: 50 });
    lock.acquire();
    lock.release();
    vi.advanceTimersByTime(49);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
  });

  it("ignores a release when nothing holds the lock", () => {
    const lock = createDoseWriteLock();
    lock.release();
    expect(lock.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not stretch a running cooldown when released twice", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();
    vi.advanceTimersByTime(400);
    lock.release();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 400);
    expect(lock.busy).toBe(false);
  });
});

describe("DoseActionForm on an 'error' result (outcome unknown)", () => {
  it("toasts, then keeps the page locked until the reload has landed, then cools down", async () => {
    let finishReload!: () => void;
    h.invalidateAll.mockImplementation(() => new Promise<void>((r) => (finishReload = r)));
    const lock = createDoseWriteLock();
    const mounted = mountDoseActionForm({
      lock,
      clock: fixedClock(new Date("2026-05-01T13:00:00.000Z")),
    });
    try {
      const { callback } = await startSubmit(h.submit!, mounted.form);
      const { update, done } = finishSubmit(callback!, mounted.form, {
        type: "error",
        status: 500,
        error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
      });

      expect(h.showToast).toHaveBeenCalledWith(
        "Something went wrong on our end. (reference a3f10c9e)",
        "error",
      );
      // release() has NOT run: a retry now would act on the list the failed
      // request may already have changed.
      await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
      expect(lock.busy).toBe(true);
      expect(update).not.toHaveBeenCalled();

      finishReload();
      await done;
      expect(lock.busy).toBe(true); // the cooldown starts only now
      vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
      expect(lock.busy).toBe(false);
    } finally {
      mounted.destroy();
    }
  });
});
