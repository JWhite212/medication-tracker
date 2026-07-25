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
vi.mock("$lib/server/doses", () => ({
  logDose: (
    userId: string,
    medicationId: string,
    quantity: number,
    takenAt?: Date,
    notes?: string,
    sideEffects?: unknown,
  ) => logDose(userId, medicationId, quantity, takenAt, notes, sideEffects),
}));

const { runCommands, dispatchCommand, UnknownCommandError } =
  await import("../../../src/lib/server/api/commands");

beforeEach(() => {
  reserveResult = [];
  selectRows = [];
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  logDose.mockClear();
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
