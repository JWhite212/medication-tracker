// The Medications list's ↑/↓ moves the keyed cards under the pointer, so it
// takes the (app) layout's dose-write lock: a Log tap cannot land on a card
// that has just moved, and a move cannot start while a log is in flight.
// Reorder is not a dose write, so it keeps `update()`; it only has to take the
// lock and give it back. It goes through the same gate as every dose write
// (beginDoseWrite), so a move refused because a write is in flight says so,
// and an offline move says nothing was saved. Mounted for real (jsdom, client
// svelte) with each form's use:enhance callback driven by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import type { MedicationWithStats } from "$lib/types";

const h = vi.hoisted(() => ({
  submits: new Map<HTMLFormElement, SubmitFunction>(),
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
vi.mock("$app/navigation", () => ({ invalidateAll: vi.fn(async () => {}), goto: vi.fn() }));
vi.mock("$app/state", () => ({
  page: { data: {} },
  navigating: { to: null, willUnload: null, complete: null },
  updated: { current: false },
}));
vi.mock("$app/environment", () => ({ browser: true, dev: false, building: false, version: "t" }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import MedicationsPage from "../../src/routes/(app)/medications/+page.svelte";
import { OFFLINE_WRITE_TOAST, STILL_SAVING_TOAST } from "$lib/components/dose-writes/copy";
import {
  createDoseWriteLock,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";

function medication(overrides: Partial<MedicationWithStats>) {
  return {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    daysUntilRefill: 20,
    expectedDailyDoses: 3,
    sparkline: [],
    refillSeverity: "ok" as const,
    ...overrides,
  };
}

const data = {
  user: {
    id: "u1",
    email: "person@example.com",
    name: "Test Person",
    avatarUrl: null,
    timezone: "UTC",
    twoFactorEnabled: false,
    emailVerified: true,
  },
  preferences: { timeFormat: "24h" },
  medications: [
    medication({ id: "m1", name: "Paracetamol", sortOrder: 0 }),
    medication({ id: "m2", name: "Ibuprofen", sortOrder: 1 }),
  ],
  archived: [],
} as unknown as ComponentProps<typeof MedicationsPage>["data"];

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;
let lock: DoseWriteLock;

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
}

beforeEach(() => {
  vi.useFakeTimers();
  h.submits.clear();
  h.showToast.mockReset();
  setOnline(true);
  lock = createDoseWriteLock();
  target = document.body.appendChild(document.createElement("div"));
  app = mount(MedicationsPage, { target, props: { data }, context: doseWriteContext(lock) });
  flushSync();
});

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target.remove();
  vi.useRealTimers();
  setOnline(true);
});

function enhancedFormOf(selector: string) {
  const form = target.querySelector<HTMLButtonElement>(selector)?.closest("form");
  const submit = form ? h.submits.get(form) : undefined;
  if (!form || !submit) throw new Error(`${selector} is not in a use:enhance form`);
  return { form, submit };
}

const MOVE_IBUPROFEN_UP = "#move-m2-up";
const LOG_PARACETAMOL = 'button[aria-label="Log a dose of Paracetamol"]';

describe("the medications list's reorder under the dose-write lock", () => {
  it("refuses a move while a dose write holds the lock, and says it is still saving", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    lock.acquire();

    const { cancel, callback } = await startSubmit(move.submit, move.form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(STILL_SAVING_TOAST, "error", { coalesce: true });
  });

  it("refuses a move in the cooldown after a write, silently: that is a double tap, not a busy lock", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    lock.acquire();
    lock.release(); // settled; only the cooldown remains
    expect(lock.busy).toBe(true);
    expect(lock.active).toBe(false);

    const { cancel, callback } = await startSubmit(move.submit, move.form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("refuses a move while offline, says nothing was saved, and takes no lock", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    setOnline(false);

    const { cancel, callback } = await startSubmit(move.submit, move.form);

    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(OFFLINE_WRITE_TOAST, "error");
    // An offline tap must not lock every dose control for the cooldown.
    expect(lock.active).toBe(false);
    expect(lock.busy).toBe(false);
  });

  it("holds the lock for the whole move, so a Log tap mid-move is refused, then lets go", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    const log = enhancedFormOf(LOG_PARACETAMOL);

    const moving = await startSubmit(move.submit, move.form);
    expect(moving.cancel).not.toHaveBeenCalled();
    expect(lock.active).toBe(true);

    const tap = await startSubmit(log.submit, log.form);
    expect(tap.cancel).toHaveBeenCalledOnce();

    const { update, done } = finishSubmit(moving.callback!, move.form, {
      type: "success",
      status: 204,
    });
    await done;

    // Reorder is not a dose write: it still hands the result to update().
    expect(update).toHaveBeenCalledOnce();
    expect(lock.active).toBe(false);
  });

  it("lets go of the lock even when the reload throws", async () => {
    const move = enhancedFormOf(MOVE_IBUPROFEN_UP);
    const moving = await startSubmit(move.submit, move.form);
    expect(lock.active).toBe(true);

    const update = vi.fn(async () => {
      throw new Error("reload failed");
    });
    const { done } = finishSubmit(
      moving.callback!,
      move.form,
      { type: "success", status: 204 },
      update,
    );
    await expect(done).rejects.toThrow("reload failed");

    expect(lock.active).toBe(false);
  });
});
