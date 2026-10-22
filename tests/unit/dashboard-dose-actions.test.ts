import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { actionErrorMessage } from "$lib/utils/form-errors";

// Verifies the dashboard's dose mutations don't report success when the
// underlying row no longer exists (deleted in another tab or via native
// -app sync). deleteDose() and updateDose() return null in that case —
// the actions must surface a failure, not `success`.
//
// The log and skip actions check the posted instant against the request's
// clock, route to the right write (Log now, Took it at, Skip or a chip) and
// map each refusal to a status the client acts on. The 401 guard is covered
// by app-action-auth-guard.test.ts, and what the writes do to the database
// by pg/dose-slot-writes.test.ts. This file pins what is left: routing, the
// clock and the error mapping.
const DELETED_AT = new Date("2026-04-16T19:05:00.000Z");
/** What deleteDose returns for a dose it removed. */
const deletedDose = () => ({ doseId: "d1", medicationId: "m1", deletedAt: DELETED_AT });

const state = {
  deleteResult: deletedDose() as ReturnType<typeof deletedDose> | null,
  updateResult: { id: "d1" } as object | null,
};

const deleteDose = vi.fn(async (..._args: unknown[]) => state.deleteResult);
const updateDose = vi.fn(async () => state.updateResult);
// The writes return what production returns — a row for each taken write,
// an id string for each skip. Each has a distinct id, so the `doseId`
// in a result names the write that produced it.
const logDose = vi.fn(async (..._args: unknown[]) => ({ id: "dose-logged" }));
const logDoseForSlot = vi.fn(async (..._args: unknown[]) => ({ id: "dose-log-now" }));
const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");
const logDoseAtSlot = vi.fn(async (..._args: unknown[]) => ({ id: "dose-at-slot" }));
const skipDoseForSlot = vi.fn(async (..._args: unknown[]) => "dose-skipped-for-slot");
const restoreDose = vi.fn(async (..._args: unknown[]) => "restored");

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
  logDoseAtSlot: (...args: unknown[]) => logDoseAtSlot(...args),
  skipDoseForSlot: (...args: unknown[]) => skipDoseForSlot(...args),
  restoreDose: (...args: unknown[]) => restoreDose(...args),
  deleteDose: (...args: unknown[]) => deleteDose(...args),
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
  state.deleteResult = deletedDose();
  state.updateResult = { id: "d1" };
  deleteDose.mockClear();
  updateDose.mockClear();
  logDose.mockClear();
  logDoseForSlot.mockClear();
  logSkippedDose.mockClear();
  logDoseAtSlot.mockClear();
  skipDoseForSlot.mockClear();
  restoreDose.mockClear();
  track.mockClear();
  // Date only: each action reads `new Date()` once per request.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dashboard deleteDose action", () => {
  const postDelete = (fields: Record<string, string>) =>
    actions.deleteDose({ request: formRequest(fields), locals } as never);

  it("returns 404 when the dose no longer exists instead of success", async () => {
    state.deleteResult = null;

    const res = await postDelete({ doseId: "gone" });

    expect(res).toMatchObject({ status: 404, data: { error: "Dose not found" } });
  });

  it("keeps the dose for Undo and hands back its restore handle", async () => {
    const res = await postDelete({ doseId: "d1" });

    expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: true });
    // D6: the server keeps the row for ten minutes; deletedAt round-trips exactly.
    expect(res).toEqual({
      success: true,
      doseId: "d1",
      restore: { deletedAt: "2026-04-16T19:05:00.000Z", expiresInMs: 600_000 },
    });
  });

  it("keeps no trash row and offers no restore for a create's Undo (forUndo=1)", async () => {
    const res = await postDelete({ doseId: "d1", forUndo: "1" });

    expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: false });
    expect(res).toEqual({ success: true, doseId: "d1" });
  });

  it("answers 400 with the existing copy when doseId is missing, deleting nothing", async () => {
    const res = await postDelete({});

    expect(res).toMatchObject({ status: 400, data: { error: "Missing dose ID" } });
    expect(deleteDose).not.toHaveBeenCalled();
  });

  it('refuses a forUndo flag other than "1" rather than guessing, deleting nothing', async () => {
    const res = await postDelete({ doseId: "d1", forUndo: "true" });

    expect(res).toMatchObject({ status: 400 });
    expect(deleteDose).not.toHaveBeenCalled();
  });
});

describe("dashboard restoreDose action", () => {
  // The outcome mapping is pinned in dose-actions.test.ts; this proves the
  // route serves the shared helper.
  it("hands the posted Undo token to restoreDose and answers success", async () => {
    const res = await actions.restoreDose({
      request: formRequest({ doseId: "d1", deletedAt: "2026-04-16T19:00:00.000Z" }),
      locals,
    } as never);

    expect(res).toEqual({ success: true, doseId: "d1" });
    expect(restoreDose).toHaveBeenCalledWith("u1", "d1", new Date("2026-04-16T19:00:00.000Z"));
  });
});

describe("dashboard editDose action", () => {
  // Before NOW: an edit may not move a dose into the future.
  const validEdit = {
    doseId: "d1",
    takenAt: "2026-04-16T08:00",
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

  // The dashboard's edit dialog is the other door to the same write; /log's
  // suite covers the rule itself. NOW is 19:05 on 16 April.
  it("refuses a time in the future and writes nothing", async () => {
    const res = await actions.editDose({
      request: formRequest({ ...validEdit, takenAt: "2026-04-16T23:45" }),
      locals,
    } as never);

    expect(res).toMatchObject({
      status: 400,
      data: { editErrors: { takenAt: [expect.any(String)] } },
    });
    expect(updateDose).not.toHaveBeenCalled();
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

  it("writes Took it at through logDoseAtSlot with the request's clock and zone, never the posted quantity", async () => {
    // Took it at is always ×1 (spec D9): the simulation proved a probe of one
    // dose, and a larger one could resolve rows it never checked.
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "3",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-at-slot" });
    expect(logDoseAtSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      undefined,
      undefined,
      NOW,
      "UTC",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("hands Took it at the posted notes and side effects", async () => {
    await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
      notes: "with food",
      sideEffects: JSON.stringify([{ name: "Nausea", severity: "mild" }]),
    });

    expect(logDoseAtSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      "with food",
      [{ name: "Nausea", severity: "mild" }],
      NOW,
      "UTC",
    );
  });

  it("answers 409 with no analytics when Took it at's instant already holds a taken dose", async () => {
    // Only a stale page offers this button there. Answering success would
    // hand its toast an Undo for the other record.
    logDoseAtSlot.mockRejectedValueOnce(new SlotAlreadyTakenError());

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

  it("answers 409 with no analytics when Took it at's row no longer offers it — a second device resolved the slot", async () => {
    logDoseAtSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
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
    expect(logDoseAtSlot).not.toHaveBeenCalled();
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
    expect(logDoseAtSlot).not.toHaveBeenCalled();
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
    expect(logDoseAtSlot).not.toHaveBeenCalled();
  });

  it("logs a chip dose exactly as before when neither is sent", async () => {
    const res = await logDoseAction({ medicationId: "m1", quantity: "2" });

    expect(res).toEqual({ success: true, doseId: "dose-logged" });
    expect(logDose).toHaveBeenCalledWith("u1", "m1", 2, undefined, undefined, undefined);
    expect(logDoseAtSlot).not.toHaveBeenCalled();
  });
});

describe("dashboard skipDose action", () => {
  it("answers 400, not 404, when medicationId is missing", async () => {
    const res = await skipDoseAction({});

    expect(res).toMatchObject({ status: 400 });
    expect(logSkippedDose).not.toHaveBeenCalled();
    expect(skipDoseForSlot).not.toHaveBeenCalled();
  });

  it("skips at now through the legacy door when neither forSlot nor takenAt is sent", async () => {
    const res = await skipDoseAction({ medicationId: "m1" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped" });
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "m1");
    expect(skipDoseForSlot).not.toHaveBeenCalled();
  });

  it("routes forSlot to skipDoseForSlot with the request's clock and the user's zone", async () => {
    const res = await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T14:00:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped-for-slot" });
    expect(skipDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("sends a forSlot still ahead to the server's re-check, not to a 'future' 400", async () => {
    // A due-now row's slot can be up to an hour ahead. The skip lands at the
    // server's min(slot, now), so a slot in the future is expected here, and
    // only the re-derivation may refuse it.
    const res = await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T19:30:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped-for-slot" });
    expect(skipDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T19:30:00.000Z"),
      NOW,
      "UTC",
    );
  });

  it("hands a pre-deploy page's takenAt-only Skip to skipDoseForSlot as the slot", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped-for-slot" });
    expect(skipDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("answers a legacy takenAt the row no longer offers with a 409, not the old 400", async () => {
    // A pre-deploy page's Skip on a slot still ahead posted its render-time
    // instant, which names no slot. skipDoseForSlot refuses it.
    skipDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T18:50:00.000Z" });

    expect(res).toMatchObject({
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });
  });

  it("answers 409 when the row no longer offers Skip — the page was stale", async () => {
    skipDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T14:00:00.000Z" });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("What's due has changed. Refresh to see what's due now.");
  });

  it("rejects forSlot and takenAt together with a 400, writing nothing", async () => {
    const res = await skipDoseAction({
      medicationId: "m1",
      takenAt: "2026-04-16T14:00:00.000Z",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("Send takenAt or forSlot, not both");
    expect(skipDoseForSlot).not.toHaveBeenCalled();
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("rejects a forSlot or takenAt that is not an ISO instant", async () => {
    for (const field of ["forSlot", "takenAt"]) {
      const res = await skipDoseAction({ medicationId: "m1", [field]: "2026-04-16T14:00" });
      expect(res, field).toMatchObject({ status: 400 });
    }
    expect(skipDoseForSlot).not.toHaveBeenCalled();
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("keeps the existing 404 shape for a medication that is gone, on either door", async () => {
    skipDoseForSlot.mockRejectedValueOnce(new MedicationNotFoundError());
    expect(
      await skipDoseAction({ medicationId: "m1", forSlot: "2026-04-16T14:00:00.000Z" }),
    ).toMatchObject({ status: 404, data: { error: "Medication not found" } });

    logSkippedDose.mockRejectedValueOnce(new MedicationNotFoundError());
    expect(await skipDoseAction({ medicationId: "m1" })).toMatchObject({
      status: 404,
      data: { error: "Medication not found" },
    });
  });
});
