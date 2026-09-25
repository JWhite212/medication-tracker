import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { actionErrorMessage } from "$lib/utils/form-errors";

// Verifies the dashboard's dose mutations don't report success when the
// underlying row no longer exists (deleted in another tab or via native
// -app sync). deleteDose() returns false and updateDose() returns null
// in that case — the actions must surface a failure, not `success`.
//
// The log and skip actions check the posted instant against the request's
// clock, route to the right write (Log now, Took it at, Skip or a chip) and
// map each refusal to a status the client acts on. The 401 guard is covered
// by app-action-auth-guard.test.ts, and what the writes do to the database
// by pg/dose-slot-writes.test.ts. This file pins what is left: routing, the
// clock and the error mapping.
const state = {
  deleteResult: true as boolean,
  updateResult: { id: "d1" } as object | null,
};

const deleteDose = vi.fn(async () => state.deleteResult);
const updateDose = vi.fn(async () => state.updateResult);
// The writes return what production returns — a row for the two taken
// writes, an id string for a skip. Each has a distinct id, so the `doseId`
// in a result names the write that produced it.
const logDose = vi.fn(async (..._args: unknown[]) => ({ id: "dose-logged" }));
const logDoseForSlot = vi.fn(async (..._args: unknown[]) => ({ id: "dose-log-now" }));
const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");

// Declared here, not inline in the factory, so a test can throw the very
// constructor the action checks with `instanceof`. The factory runs at the
// dynamic import below, after these exist.
class MedicationNotFoundError extends Error {}
class SlotAlreadyTakenError extends Error {}
class SlotTargetChangedError extends Error {}

const track = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@vercel/analytics/server", () => ({ track: (...args: unknown[]) => track(...args) }));
vi.mock("$lib/server/medications", () => ({ getActiveMedications: async () => [] }));
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: async () => [] }));
vi.mock("$lib/server/schedules", () => ({ getSchedulesForUser: async () => new Map() }));
vi.mock("$lib/server/doses", () => ({
  getDosesInRange: async () => [],
  getLastDosePerMedication: async () => [],
  logDose: (...args: unknown[]) => logDose(...args),
  logDoseForSlot: (...args: unknown[]) => logDoseForSlot(...args),
  logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),
  deleteDose: (...args: unknown[]) => deleteDose(...(args as [])),
  updateDose: (...args: unknown[]) => updateDose(...(args as [])),
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
}));

const { actions } = await import("../../src/routes/(app)/dashboard/+page.server");

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };

/**
 * 19:05 UTC on 16 April. In UTC, `visibleStart` at this instant is today's
 * midnight (19:05 − 12h is already today). So anything before 00:00 on the
 * 16th is stale, and anything after 19:05 is in the future.
 */
const NOW = new Date("2026-04-16T19:05:00.000Z");

const logDoseAction = (fields: Record<string, string>) =>
  actions.logDose({ request: formRequest(fields), locals } as never);
const skipDoseAction = (fields: Record<string, string>) =>
  actions.skipDose({ request: formRequest(fields), locals } as never);

/** What the page will toast. The client reads every failure through actionErrorMessage. */
function toastFor(res: unknown): string {
  const { status, data } = res as { status: number; data: Record<string, unknown> };
  return actionErrorMessage({ type: "failure", status, data });
}

beforeEach(() => {
  state.deleteResult = true;
  state.updateResult = { id: "d1" };
  deleteDose.mockClear();
  updateDose.mockClear();
  logDose.mockClear();
  logDoseForSlot.mockClear();
  logSkippedDose.mockClear();
  track.mockClear();
  // Date only: each action reads `new Date()` once per request.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dashboard deleteDose action", () => {
  it("returns 404 when the dose no longer exists instead of success", async () => {
    state.deleteResult = false;
    const res = await actions.deleteDose({
      request: formRequest({ doseId: "gone" }),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 404 });
  });

  it("returns success when the dose was actually deleted", async () => {
    const res = await actions.deleteDose({
      request: formRequest({ doseId: "d1" }),
      locals,
    } as never);
    expect(res).toEqual({ success: true });
  });
});

describe("dashboard editDose action", () => {
  const validEdit = {
    doseId: "d1",
    takenAt: "2026-08-04T10:00",
    quantity: "2",
    sideEffects: "[]",
  };

  it("returns 404 when the dose no longer exists instead of success", async () => {
    state.updateResult = null;
    const res = await actions.editDose({
      request: formRequest(validEdit),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 404 });
  });

  it("returns success when the dose was actually updated", async () => {
    const res = await actions.editDose({
      request: formRequest(validEdit),
      locals,
    } as never);
    expect(res).toEqual({ success: true });
  });
});

describe("dashboard logDose action", () => {
  it("routes forSlot to logDoseForSlot with the request's clock and the user's zone", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-log-now" });
    expect(logDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("answers 409 when the Log-now target moved between render and tap (14:00 drawn at 18:50, posted at 19:05)", async () => {
    // At 18:50 a dose logged now counted for 14:00. At 19:05 the 20:00 slot
    // is within the hour and takes it. The recompute is logDoseForSlot's
    // (proven on PGlite in pg/dose-slot-writes.test.ts); this test pins what
    // the action does with the refusal.
    logDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("What's due has changed. Refresh to see what's due now.");
  });

  it("keeps the existing 404 shape when Log now's medication is gone", async () => {
    logDoseForSlot.mockRejectedValueOnce(new MedicationNotFoundError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
  });

  it("writes Took it at through logDose with the exact-instant guard", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-logged" });
    expect(logDose).toHaveBeenCalledWith(
      "u1",
      "m1",
      1,
      new Date("2026-04-16T14:00:00.000Z"),
      undefined,
      undefined,
      { exactInstantGuard: true },
    );
  });

  it("answers 409 with no analytics when Took it at's instant already holds a taken dose", async () => {
    // Only a stale page offers this button there. Answering success would
    // hand its toast an Undo for the other record.
    logDose.mockRejectedValueOnce(new SlotAlreadyTakenError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["This dose is already logged as taken. Refresh to see it."] } },
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("refuses a takenAt after now with a 400 on the field, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T19:05:00.001Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("That time hasn't happened yet.");
    expect(logDose).not.toHaveBeenCalled();
  });

  it("refuses a takenAt the dashboard no longer shows with a 409, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-15T23:59:59.999Z",
    });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe(
      "This dose has moved off your dashboard. Refresh to see what's due now.",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("rejects takenAt and forSlot together with a 400, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("Send takenAt or forSlot, not both");
    expect(logDose).not.toHaveBeenCalled();
    expect(logDoseForSlot).not.toHaveBeenCalled();
  });

  it("logs a chip dose exactly as before when neither is sent", async () => {
    const res = await logDoseAction({ medicationId: "m1", quantity: "2" });

    expect(res).toEqual({ success: true, doseId: "dose-logged" });
    expect(logDose).toHaveBeenCalledWith("u1", "m1", 2, undefined, undefined, undefined);
  });
});

describe("dashboard skipDose action", () => {
  it("answers 400, not 404, when medicationId is missing", async () => {
    const res = await skipDoseAction({});

    expect(res).toMatchObject({ status: 400 });
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("skips at now through the legacy door when no takenAt is sent", async () => {
    const res = await skipDoseAction({ medicationId: "m1" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped" });
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "m1");
  });

  it("skips the row's own instant with the exact-instant guard", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped" });
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "m1", new Date("2026-04-16T14:00:00.000Z"), {
      exactInstantGuard: true,
    });
  });

  it("refuses a takenAt after now with a 400 on the field", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T19:05:00.001Z" });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("That time hasn't happened yet.");
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("refuses a stale takenAt with a 409", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-15T23:59:59.999Z" });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe(
      "This dose has moved off your dashboard. Refresh to see what's due now.",
    );
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("rejects a takenAt that is not an ISO instant", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00" });

    expect(res).toMatchObject({ status: 400 });
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("answers 409 when the instant already holds a taken dose", async () => {
    logSkippedDose.mockRejectedValueOnce(new SlotAlreadyTakenError());

    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("This dose is already logged as taken. Refresh to see it.");
  });

  it("answers 409 when the instant already holds a skip — the page was stale", async () => {
    logSkippedDose.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });
  });

  it("keeps the existing 404 shape for a medication that is gone", async () => {
    logSkippedDose.mockRejectedValueOnce(new MedicationNotFoundError());

    const res = await skipDoseAction({ medicationId: "m1" });

    expect(res).toMatchObject({ status: 404, data: { error: "Medication not found" } });
  });
});
