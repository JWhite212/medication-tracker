import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "../helpers/fake-db";
import { apiCommands } from "$lib/server/db/schema";
import { upsertMedicationPayload } from "$lib/utils/validation";

// Controllable mock state for each db operation used by the reserve-first
// algorithm in runCommands.

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real apiCommands
// table. The reserve INSERT ... RETURNING reads the standing seed, while the
// replay SELECT reads a one-shot queue in front of it, which is how the two
// stay independently primed on the same table.
vi.mock("$lib/server/db", async () => (await import("../helpers/fake-db")).dbMock);

const payloadsOf = (kind: "insert" | "update" | "delete") =>
  fakeDb.attempted.filter((c) => c.op === kind).map((c) => c.payload);

const inserts = () => payloadsOf("insert");
const updates = () => payloadsOf("update");
// The old fake pushed a bare 1 per delete; preserve that shape.
const deletes = () => payloadsOf("delete").map(() => 1);

const logDose = vi.fn(
  async (
    _userId: string,
    _medicationId: string,
    _quantity: number,
    _takenAt?: Date,
    _notes?: string,
    _sideEffects?: unknown,
  ): Promise<{ id: string }> => ({ id: "dose-1" }),
);
const logSkippedDose = vi.fn(
  async (_userId: string, _medicationId: string): Promise<string> => "skipped-dose-1",
);
const updateDose = vi.fn(
  async (
    _userId: string,
    _doseId: string,
    _updates: {
      takenAt?: Date;
      quantity?: number;
      notes?: string;
      sideEffects?: unknown;
    },
  ): Promise<{ id: string } | null> => ({ id: "dose-1" }),
);
const deleteDose = vi.fn(async (_userId: string, _doseId: string): Promise<boolean> => true);
vi.mock("$lib/server/doses", () => ({
  logDose: (
    userId: string,
    medicationId: string,
    quantity: number,
    takenAt?: Date,
    notes?: string,
    sideEffects?: unknown,
  ) => logDose(userId, medicationId, quantity, takenAt, notes, sideEffects),
  logSkippedDose: (userId: string, medicationId: string) => logSkippedDose(userId, medicationId),
  updateDose: (
    userId: string,
    doseId: string,
    updates: { takenAt?: Date; quantity?: number; notes?: string; sideEffects?: unknown },
  ) => updateDose(userId, doseId, updates),
  deleteDose: (userId: string, doseId: string) => deleteDose(userId, doseId),
}));

const refillMedication = vi.fn(
  async (
    _userId: string,
    _medicationId: string,
    _quantity: number,
    _note?: string | null,
  ): Promise<{ previousCount: number | null; newCount: number }> => ({
    previousCount: 10,
    newCount: 40,
  }),
);
const adjustInventory = vi.fn(
  async (
    _userId: string,
    _medicationId: string,
    _newCount: number,
    _note?: string | null,
  ): Promise<{ previousCount: number | null; newCount: number; quantityChange: number }> => ({
    previousCount: 10,
    newCount: 7,
    quantityChange: -3,
  }),
);
vi.mock("$lib/server/inventory-events", () => ({
  refillMedication: (
    userId: string,
    medicationId: string,
    quantity: number,
    note?: string | null,
  ) => refillMedication(userId, medicationId, quantity, note),
  adjustInventory: (userId: string, medicationId: string, newCount: number, note?: string | null) =>
    adjustInventory(userId, medicationId, newCount, note),
}));

const createMedicationWithSchedules = vi.fn(
  async (
    _userId: string,
    _input: unknown,
    _schedules: unknown,
  ): Promise<{ id: string } | null> => ({ id: "med-created" }),
);
const updateMedicationWithSchedules = vi.fn(
  async (
    _userId: string,
    _id: string,
    _input: unknown,
    _schedules: unknown,
  ): Promise<{ id: string } | null> => ({ id: "med-updated" }),
);
const archiveMedication = vi.fn(async (_userId: string, _id: string): Promise<void> => {});
const unarchiveMedication = vi.fn(async (_userId: string, _id: string): Promise<void> => {});
const swapSortOrder = vi.fn(
  async (_userId: string, _medId1: string, _medId2: string): Promise<void> => {},
);
vi.mock("$lib/server/medications", () => ({
  createMedicationWithSchedules: (userId: string, input: unknown, schedules: unknown) =>
    createMedicationWithSchedules(userId, input, schedules),
  updateMedicationWithSchedules: (userId: string, id: string, input: unknown, schedules: unknown) =>
    updateMedicationWithSchedules(userId, id, input, schedules),
  archiveMedication: (userId: string, id: string) => archiveMedication(userId, id),
  unarchiveMedication: (userId: string, id: string) => unarchiveMedication(userId, id),
  swapSortOrder: (userId: string, medId1: string, medId2: string) =>
    swapSortOrder(userId, medId1, medId2),
}));

const updatePreferences = vi.fn(
  async (_userId: string, _updates: unknown): Promise<{ userId: string; accentColor: string }> => ({
    userId: "u1",
    accentColor: "#111111",
  }),
);
const getOrCreatePreferences = vi.fn(
  async (_userId: string): Promise<{ userId: string; accentColor: string }> => ({
    userId: "u1",
    accentColor: "#000000",
  }),
);
vi.mock("$lib/server/preferences", () => ({
  updatePreferences: (userId: string, updates: unknown) => updatePreferences(userId, updates),
  getOrCreatePreferences: (userId: string) => getOrCreatePreferences(userId),
}));

const wipeDoseHistory = vi.fn(
  async (_userId: string): Promise<{ deleted: number }> => ({ deleted: 5 }),
);
const wipeArchivedMedications = vi.fn(
  async (_userId: string): Promise<{ deleted: number }> => ({ deleted: 2 }),
);
vi.mock("$lib/server/api/wipe", () => ({
  wipeDoseHistory: (userId: string) => wipeDoseHistory(userId),
  wipeArchivedMedications: (userId: string) => wipeArchivedMedications(userId),
}));

const { runCommands, dispatchCommand, UnknownCommandError } =
  await import("../../../src/lib/server/api/commands");

beforeEach(() => {
  fakeDb.reset();
  logDose.mockClear();
  logSkippedDose.mockClear();
  updateDose.mockClear();
  deleteDose.mockClear();
  refillMedication.mockClear();
  adjustInventory.mockClear();
  createMedicationWithSchedules.mockClear();
  updateMedicationWithSchedules.mockClear();
  archiveMedication.mockClear();
  unarchiveMedication.mockClear();
  swapSortOrder.mockClear();
  updatePreferences.mockClear();
  getOrCreatePreferences.mockClear();
  wipeDoseHistory.mockClear();
  wipeArchivedMedications.mockClear();
});

describe("runCommands", () => {
  it("fresh command: reserves, dispatches, and records the result", async () => {
    fakeDb.seed(apiCommands, [{ idempotencyKey: "cmd-1" }]);
    const commands = [
      {
        id: "cmd-1",
        type: "log_dose",
        payload: { medicationId: "med-1", quantity: 2, notes: "with food" },
      },
    ];

    const results = await runCommands("u1", commands);

    expect(logDose).toHaveBeenCalledTimes(1);
    expect(logDose).toHaveBeenCalledWith("u1", "med-1", 2, undefined, "with food", undefined);

    expect(inserts()).toEqual([{ userId: "u1", idempotencyKey: "cmd-1", result: null }]);
    expect(updates()).toEqual([{ result: { id: "dose-1" } }]);
    expect(deletes()).toEqual([]);

    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-1" } }]);
  });

  it("completed replay: reserve loses, cached result is returned without re-executing", async () => {
    fakeDb.seed(apiCommands, []);
    fakeDb.seedQueue(apiCommands, [[{ result: { id: "dose-cached" } }]]);
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(deletes()).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-cached" } }]);
  });

  it("in-progress: reserve loses, existing row has null result — never re-executes", async () => {
    fakeDb.seed(apiCommands, []);
    fakeDb.seedQueue(apiCommands, [[{ result: null }]]);
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
    expect(deletes()).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: false, error: "in_progress" }]);
  });

  it("dispatch failure: reservation is released so the id can be retried", async () => {
    fakeDb.seed(apiCommands, [{ idempotencyKey: "cmd-1" }]);
    logDose.mockRejectedValueOnce(new Error("db write failed"));
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).toHaveBeenCalledTimes(1);
    expect(deletes()).toEqual([1]);
    expect(updates()).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: false, error: "db write failed" }]);
  });

  it("result-write failure: reservation preserved, caller still gets its result, replay never re-dispatches", async () => {
    fakeDb.seed(apiCommands, [{ idempotencyKey: "cmd-1" }]);
    fakeDb.failNext("update", { error: new Error("result write failed") });
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    // Dispatch happened...
    expect(logDose).toHaveBeenCalledTimes(1);
    // ...but the reservation was NOT released, because the mutation is
    // already durably committed at this point (only the ledger write failed).
    expect(deletes()).toEqual([]);
    // The caller that actually ran the dispatch still gets its result back
    // this turn, even though persisting it to the ledger failed.
    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-1" } }]);

    // Simulate a retry/replay of the same command id: the reservation still
    // exists (insert loses the race) and its result column is still null
    // because the update above failed to persist it.
    fakeDb.seed(apiCommands, []);
    fakeDb.seedQueue(apiCommands, [[{ result: null }]]);

    const replay = await runCommands("u1", commands);

    expect(logDose).toHaveBeenCalledTimes(1); // NOT called again
    expect(replay).toEqual([{ id: "cmd-1", ok: false, error: "in_progress" }]);
  });

  it("unknown command type: caught by the dispatch-fail path, reservation released", async () => {
    fakeDb.seed(apiCommands, [{ idempotencyKey: "cmd-1" }]);
    const commands = [{ id: "cmd-1", type: "not_a_real_command", payload: {} }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(deletes()).toEqual([1]);
    expect(updates()).toEqual([]);
    expect(results).toEqual([
      { id: "cmd-1", ok: false, error: "Unknown command: not_a_real_command" },
    ]);
  });
});

describe("dispatchCommand", () => {
  it("throws UnknownCommandError for an unregistered type", async () => {
    await expect(dispatchCommand("u1", "nope", {})).rejects.toThrow(UnknownCommandError);
  });
});

describe("dispatchCommand — dose + inventory commands (Task 12)", () => {
  it("skip_dose calls logSkippedDose with the mapped medicationId and returns {id}", async () => {
    logSkippedDose.mockResolvedValueOnce("skip-1");

    const result = await dispatchCommand("u1", "skip_dose", { medicationId: "med-1" });

    expect(logSkippedDose).toHaveBeenCalledTimes(1);
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "med-1");
    expect(result).toEqual({ id: "skip-1" });
  });

  it("edit_dose calls updateDose with the mapped fields and returns {updated: true} on a hit", async () => {
    updateDose.mockResolvedValueOnce({ id: "dose-1" });

    const result = await dispatchCommand("u1", "edit_dose", {
      doseId: "dose-1",
      takenAt: "2026-07-25T08:00:00.000Z",
      quantity: 2,
      notes: "with food",
      sideEffects: [{ name: "nausea", severity: "mild" }],
    });

    expect(updateDose).toHaveBeenCalledTimes(1);
    expect(updateDose).toHaveBeenCalledWith("u1", "dose-1", {
      takenAt: new Date("2026-07-25T08:00:00.000Z"),
      quantity: 2,
      notes: "with food",
      sideEffects: [{ name: "nausea", severity: "mild" }],
    });
    expect(result).toEqual({ updated: true });
  });

  it("edit_dose returns {updated: false} when updateDose finds no matching dose", async () => {
    updateDose.mockResolvedValueOnce(null);

    const result = await dispatchCommand("u1", "edit_dose", { doseId: "missing" });

    expect(updateDose).toHaveBeenCalledWith("u1", "missing", {
      takenAt: undefined,
      quantity: undefined,
      notes: undefined,
      sideEffects: undefined,
    });
    expect(result).toEqual({ updated: false });
  });

  it("edit_dose passes an explicit null sideEffects through to updateDose (clear), not undefined", async () => {
    updateDose.mockResolvedValueOnce({ id: "dose-1" });

    await dispatchCommand("u1", "edit_dose", { doseId: "dose-1", sideEffects: null });

    expect(updateDose).toHaveBeenCalledWith(
      "u1",
      "dose-1",
      expect.objectContaining({ sideEffects: null }),
    );
  });

  it("delete_dose calls deleteDose with the mapped doseId and returns {deleted: boolean}", async () => {
    deleteDose.mockResolvedValueOnce(true);

    const result = await dispatchCommand("u1", "delete_dose", { doseId: "dose-1" });

    expect(deleteDose).toHaveBeenCalledTimes(1);
    expect(deleteDose).toHaveBeenCalledWith("u1", "dose-1");
    expect(result).toEqual({ deleted: true });
  });

  it("refill calls refillMedication with the mapped args and returns its result verbatim", async () => {
    refillMedication.mockResolvedValueOnce({ previousCount: 10, newCount: 40 });

    const result = await dispatchCommand("u1", "refill", {
      medicationId: "med-1",
      quantity: 30,
      note: "pharmacy pickup",
    });

    expect(refillMedication).toHaveBeenCalledTimes(1);
    expect(refillMedication).toHaveBeenCalledWith("u1", "med-1", 30, "pharmacy pickup");
    expect(result).toEqual({ previousCount: 10, newCount: 40 });
  });

  it("refill defaults a missing note to null", async () => {
    await dispatchCommand("u1", "refill", { medicationId: "med-1", quantity: 5 });

    expect(refillMedication).toHaveBeenCalledWith("u1", "med-1", 5, null);
  });

  it("adjust_inventory calls adjustInventory with the mapped args and returns its result verbatim", async () => {
    adjustInventory.mockResolvedValueOnce({ previousCount: 10, newCount: 7, quantityChange: -3 });

    const result = await dispatchCommand("u1", "adjust_inventory", {
      medicationId: "med-1",
      newCount: 7,
      note: "spilled pills",
    });

    expect(adjustInventory).toHaveBeenCalledTimes(1);
    expect(adjustInventory).toHaveBeenCalledWith("u1", "med-1", 7, "spilled pills");
    expect(result).toEqual({ previousCount: 10, newCount: 7, quantityChange: -3 });
  });

  it("adjust_inventory defaults a missing note to null", async () => {
    await dispatchCommand("u1", "adjust_inventory", { medicationId: "med-1", newCount: 0 });

    expect(adjustInventory).toHaveBeenCalledWith("u1", "med-1", 0, null);
  });
});

describe("dispatchCommand — medication + schedule + preference + wipe commands (Task 13)", () => {
  const rawMedication = {
    name: "Vitamin D",
    dosageAmount: "1000",
    dosageUnit: "IU",
    form: "tablet" as const,
    category: "supplement" as const,
    colour: "#f59e0b",
    pattern: "solid" as const,
    scheduleType: "scheduled" as const,
  };
  const rawSchedules = [{ scheduleKind: "prn" as const }];
  // The handler re-parses the payload internally; parse it here too so
  // assertions compare against exactly what the handler actually passes
  // downstream (defaults applied, transforms run), not the raw literal.
  const { medication: parsedMedication, schedules: parsedSchedules } =
    upsertMedicationPayload.parse({ medication: rawMedication, schedules: rawSchedules });

  it("upsert_medication_with_schedules with no id calls createMedicationWithSchedules and wraps the result", async () => {
    createMedicationWithSchedules.mockResolvedValueOnce({ id: "med-created" });

    const result = await dispatchCommand("u1", "upsert_medication_with_schedules", {
      medication: rawMedication,
      schedules: rawSchedules,
    });

    expect(createMedicationWithSchedules).toHaveBeenCalledTimes(1);
    expect(createMedicationWithSchedules).toHaveBeenCalledWith(
      "u1",
      parsedMedication,
      parsedSchedules,
    );
    expect(updateMedicationWithSchedules).not.toHaveBeenCalled();
    expect(result).toEqual({ medication: { id: "med-created" } });
  });

  it("upsert_medication_with_schedules with an id calls updateMedicationWithSchedules and wraps the result", async () => {
    updateMedicationWithSchedules.mockResolvedValueOnce({ id: "med-updated" });

    const result = await dispatchCommand("u1", "upsert_medication_with_schedules", {
      id: "med-1",
      medication: rawMedication,
      schedules: rawSchedules,
    });

    expect(updateMedicationWithSchedules).toHaveBeenCalledTimes(1);
    expect(updateMedicationWithSchedules).toHaveBeenCalledWith(
      "u1",
      "med-1",
      parsedMedication,
      parsedSchedules,
    );
    expect(createMedicationWithSchedules).not.toHaveBeenCalled();
    expect(result).toEqual({ medication: { id: "med-updated" } });
  });

  it("upsert_medication_with_schedules still returns a non-null wrapper when updateMedicationWithSchedules finds no owned medication", async () => {
    updateMedicationWithSchedules.mockResolvedValueOnce(null);

    const result = await dispatchCommand("u1", "upsert_medication_with_schedules", {
      id: "missing",
      medication: rawMedication,
      schedules: rawSchedules,
    });

    // The domain fn returned null, but the handler's own result must be a
    // non-null object — the idempotency ledger treats a null `result`
    // column as "in progress" (see the INVARIANT comment above `handlers`).
    expect(result).not.toBeNull();
    expect(result).toEqual({ medication: null });
  });

  it("archive calls archiveMedication with the mapped medicationId and returns {ok: true}", async () => {
    const result = await dispatchCommand("u1", "archive", { medicationId: "med-1" });

    expect(archiveMedication).toHaveBeenCalledTimes(1);
    expect(archiveMedication).toHaveBeenCalledWith("u1", "med-1");
    expect(result).toEqual({ ok: true });
  });

  it("unarchive calls unarchiveMedication with the mapped medicationId and returns {ok: true}", async () => {
    const result = await dispatchCommand("u1", "unarchive", { medicationId: "med-1" });

    expect(unarchiveMedication).toHaveBeenCalledTimes(1);
    expect(unarchiveMedication).toHaveBeenCalledWith("u1", "med-1");
    expect(result).toEqual({ ok: true });
  });

  it("reorder calls swapSortOrder with the mapped medication ids and returns {ok: true}", async () => {
    const result = await dispatchCommand("u1", "reorder", { medId1: "med-1", medId2: "med-2" });

    expect(swapSortOrder).toHaveBeenCalledTimes(1);
    expect(swapSortOrder).toHaveBeenCalledWith("u1", "med-1", "med-2");
    expect(result).toEqual({ ok: true });
  });

  // Row-existence and the audit row are updatePreferences' own guarantees
  // now, pinned in tests/unit/preferences.test.ts — this only checks that
  // the handler parses the payload and wraps the result.
  it("update_preferences calls updatePreferences with the parsed payload and wraps the result", async () => {
    updatePreferences.mockResolvedValueOnce({ userId: "u1", accentColor: "#123456" });

    const result = await dispatchCommand("u1", "update_preferences", {
      accentColor: "#123456",
      doseLogPageSize: 25,
    });

    expect(updatePreferences).toHaveBeenCalledTimes(1);
    expect(updatePreferences).toHaveBeenCalledWith("u1", {
      accentColor: "#123456",
      doseLogPageSize: 25,
    });
    expect(result).toEqual({ preferences: { userId: "u1", accentColor: "#123456" } });
  });

  it("wipe_dose_history calls wipeDoseHistory with the userId and returns {deleted}", async () => {
    wipeDoseHistory.mockResolvedValueOnce({ deleted: 12 });

    const result = await dispatchCommand("u1", "wipe_dose_history", {});

    expect(wipeDoseHistory).toHaveBeenCalledTimes(1);
    expect(wipeDoseHistory).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ deleted: 12 });
  });

  it("wipe_archived_medications calls wipeArchivedMedications with the userId and returns {deleted}", async () => {
    wipeArchivedMedications.mockResolvedValueOnce({ deleted: 3 });

    const result = await dispatchCommand("u1", "wipe_archived_medications", {});

    expect(wipeArchivedMedications).toHaveBeenCalledTimes(1);
    expect(wipeArchivedMedications).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ deleted: 3 });
  });
});
