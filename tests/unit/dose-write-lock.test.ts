// The dashboard's page-wide dose-write lock. Every log, skip, undo and remove
// on the page takes it, so a double tap — or a tap on a row that is about to
// re-render away — cannot write twice. Part E adds the DoseActionForm case
// whose ORDERING matters most (an 'error' result frees the page only after
// the reload has landed).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";

beforeEach(() => {
  vi.useFakeTimers();
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
