import { describe, it, expect, vi, beforeEach } from "vitest";

// api_commands is the idempotency ledger — table identity only matters
// for drizzle's typings here, the mock db below ignores the actual
// column refs and is driven entirely by `reserveResult`/`selectRows`/`inserts`.
const apiCommandsTable = { idempotencyKey: "idempotencyKey" };
vi.mock("$lib/server/db/schema", () => ({ apiCommands: apiCommandsTable }));

// Controllable mock state for each db operation used by the reserve-first
// algorithm in runCommands.
let reserveResult: Array<{ idempotencyKey: string }> = [];
let selectRows: Array<{ result: unknown }> = [];
const inserts: Array<{ userId: string; idempotencyKey: string; result: unknown }> = [];
const updates: Array<{ result: unknown }> = [];
const deletes: number[] = [];
// When true, the NEXT update(...).set(...).where(...) call rejects instead
// of resolving (and resets the flag) — simulates the result-write failing
// after a successful dispatch.
let updateShouldRejectOnce = false;

function buildDb() {
  return {
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: number) => Promise.resolve(selectRows),
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (row: { userId: string; idempotencyKey: string; result: unknown }) => ({
        onConflictDoNothing: () => ({
          returning: (_cols: unknown) => {
            inserts.push(row);
            return Promise.resolve(reserveResult);
          },
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (row: { result: unknown }) => ({
        where: (_cond: unknown) => {
          updates.push(row);
          if (updateShouldRejectOnce) {
            updateShouldRejectOnce = false;
            return Promise.reject(new Error("result write failed"));
          }
          return Promise.resolve();
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => {
        deletes.push(1);
        return Promise.resolve();
      },
    }),
  };
}

vi.mock("$lib/server/db", () => ({ db: buildDb() }));

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

const { runCommands, dispatchCommand, UnknownCommandError } =
  await import("../../../src/lib/server/api/commands");

beforeEach(() => {
  reserveResult = [];
  selectRows = [];
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  updateShouldRejectOnce = false;
  logDose.mockClear();
  logSkippedDose.mockClear();
  updateDose.mockClear();
  deleteDose.mockClear();
  refillMedication.mockClear();
  adjustInventory.mockClear();
});

describe("runCommands", () => {
  it("fresh command: reserves, dispatches, and records the result", async () => {
    reserveResult = [{ idempotencyKey: "cmd-1" }];
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

    expect(inserts).toEqual([{ userId: "u1", idempotencyKey: "cmd-1", result: null }]);
    expect(updates).toEqual([{ result: { id: "dose-1" } }]);
    expect(deletes).toEqual([]);

    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-1" } }]);
  });

  it("completed replay: reserve loses, cached result is returned without re-executing", async () => {
    reserveResult = [];
    selectRows = [{ result: { id: "dose-cached" } }];
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-cached" } }]);
  });

  it("in-progress: reserve loses, existing row has null result — never re-executes", async () => {
    reserveResult = [];
    selectRows = [{ result: null }];
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: false, error: "in_progress" }]);
  });

  it("dispatch failure: reservation is released so the id can be retried", async () => {
    reserveResult = [{ idempotencyKey: "cmd-1" }];
    logDose.mockRejectedValueOnce(new Error("db write failed"));
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).toHaveBeenCalledTimes(1);
    expect(deletes).toEqual([1]);
    expect(updates).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: false, error: "db write failed" }]);
  });

  it("result-write failure: reservation preserved, caller still gets its result, replay never re-dispatches", async () => {
    reserveResult = [{ idempotencyKey: "cmd-1" }];
    updateShouldRejectOnce = true;
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    // Dispatch happened...
    expect(logDose).toHaveBeenCalledTimes(1);
    // ...but the reservation was NOT released, because the mutation is
    // already durably committed at this point (only the ledger write failed).
    expect(deletes).toEqual([]);
    // The caller that actually ran the dispatch still gets its result back
    // this turn, even though persisting it to the ledger failed.
    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-1" } }]);

    // Simulate a retry/replay of the same command id: the reservation still
    // exists (insert loses the race) and its result column is still null
    // because the update above failed to persist it.
    reserveResult = [];
    selectRows = [{ result: null }];

    const replay = await runCommands("u1", commands);

    expect(logDose).toHaveBeenCalledTimes(1); // NOT called again
    expect(replay).toEqual([{ id: "cmd-1", ok: false, error: "in_progress" }]);
  });

  it("unknown command type: caught by the dispatch-fail path, reservation released", async () => {
    reserveResult = [{ idempotencyKey: "cmd-1" }];
    const commands = [{ id: "cmd-1", type: "not_a_real_command", payload: {} }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(deletes).toEqual([1]);
    expect(updates).toEqual([]);
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
