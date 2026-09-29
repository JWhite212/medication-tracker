import { describe, it, expect, vi, beforeEach } from "vitest";

// Same contract as tests/unit/dashboard-dose-actions.test.ts, for the
// Log page: a stale dose row (removed in another tab/session) must not
// produce `{ success: true }` and a "Dose updated" toast. The delete is
// the shared deleteDoseAction, so /log answers exactly as the dashboard.
const DELETED_AT = new Date("2026-08-04T10:00:00.000Z");
/** What deleteDose returns for a dose it removed. */
const deletedDose = () => ({ doseId: "d1", medicationId: "m1", deletedAt: DELETED_AT });

const state = {
  deleteResult: deletedDose() as ReturnType<typeof deletedDose> | null,
  updateResult: { id: "d1" } as object | null,
};

const deleteDose = vi.fn(async (..._args: unknown[]) => state.deleteResult);
const updateDose = vi.fn(async () => state.updateResult);

// This module imports `db` but must never reach it. unusedDb THROWS on any
// property access, so an accidental query fails loudly instead of silently
// returning [] — do not "upgrade" this to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/doses", () => ({
  deleteDose: (...args: unknown[]) => deleteDose(...args),
  updateDose: (...args: unknown[]) => updateDose(...(args as [])),
}));

const { actions } = await import("../../src/routes/(app)/log/+page.server");

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };

beforeEach(() => {
  state.deleteResult = deletedDose();
  state.updateResult = { id: "d1" };
  deleteDose.mockClear();
  updateDose.mockClear();
});

describe("log editDose action", () => {
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

describe("log deleteDose action", () => {
  const postDelete = (fields: Record<string, string>) =>
    actions.deleteDose({ request: formRequest(fields), locals } as never);

  it("returns 404 when the dose no longer exists", async () => {
    state.deleteResult = null;

    const res = await postDelete({ doseId: "gone" });

    expect(res).toMatchObject({ status: 404, data: { error: "Dose not found" } });
  });

  it("keeps the dose for Undo and hands back its restore handle", async () => {
    const res = await postDelete({ doseId: "d1" });

    expect(deleteDose).toHaveBeenCalledWith("u1", "d1", { keepForUndo: true });
    expect(res).toEqual({
      success: true,
      doseId: "d1",
      restore: { deletedAt: "2026-08-04T10:00:00.000Z", expiresInMs: 600_000 },
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
});
