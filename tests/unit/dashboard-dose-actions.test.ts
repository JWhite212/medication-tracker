import { describe, it, expect, vi, beforeEach } from "vitest";

// Verifies the dashboard's dose mutations don't report success when the
// underlying row no longer exists (deleted in another tab or via native
// -app sync). deleteDose() returns false and updateDose() returns null
// in that case — the actions must surface a failure, not `success`.
const state = {
  deleteResult: true as boolean,
  updateResult: { id: "d1" } as object | null,
};

const deleteDose = vi.fn(async () => state.deleteResult);
const updateDose = vi.fn(async () => state.updateResult);

vi.mock("@vercel/analytics/server", () => ({ track: async () => {} }));
vi.mock("$lib/server/medications", () => ({ getActiveMedications: async () => [] }));
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: async () => [] }));
vi.mock("$lib/server/schedules", () => ({ getSchedulesForUser: async () => new Map() }));
vi.mock("$lib/server/doses", () => ({
  getTodaysDoses: async () => [],
  getLastDosePerMedication: async () => [],
  logDose: async () => ({}),
  logSkippedDose: async () => ({}),
  deleteDose: (...args: unknown[]) => deleteDose(...(args as [])),
  updateDose: (...args: unknown[]) => updateDose(...(args as [])),
  MedicationNotFoundError: class MedicationNotFoundError extends Error {},
}));

const { actions } = await import("../../src/routes/(app)/dashboard/+page.server");

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
