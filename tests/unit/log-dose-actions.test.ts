import { describe, it, expect, vi, beforeEach } from "vitest";

// Same contract as tests/unit/dashboard-dose-actions.test.ts, for the
// Log page: a stale dose row (removed in another tab/session) must not
// produce `{ success: true }` and a "Dose updated" toast.
const state = {
  deleteResult: true as boolean,
  updateResult: { id: "d1" } as object | null,
};

const deleteDose = vi.fn(async () => state.deleteResult);
const updateDose = vi.fn(async () => state.updateResult);

// This module imports `db` but must never reach it. unusedDb THROWS on any
// property access, so an accidental query fails loudly instead of silently
// returning [] — do not "upgrade" this to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/doses", () => ({
  deleteDose: (...args: unknown[]) => deleteDose(...(args as [])),
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
  state.deleteResult = true;
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

describe("log deleteDose action (regression — already correct)", () => {
  it("returns 404 when the dose no longer exists", async () => {
    state.deleteResult = false;
    const res = await actions.deleteDose({
      request: formRequest({ doseId: "gone" }),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 404 });
  });
});
