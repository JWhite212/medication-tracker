import { describe, it, expect, vi, beforeEach } from "vitest";

// api_commands is the idempotency ledger — table identity only matters
// for drizzle's typings here, the mock db below ignores the actual
// column refs and is driven entirely by `cachedRows`/`inserts`.
const apiCommandsTable = {};
vi.mock("$lib/server/db/schema", () => ({ apiCommands: apiCommandsTable }));

let cachedRows: Array<{ result: unknown }> = [];
const inserts: Array<{ userId: string; idempotencyKey: string; result: unknown }> = [];

function buildDb() {
  return {
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          limit: (_n: number) => Promise.resolve(cachedRows),
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (row: { userId: string; idempotencyKey: string; result: unknown }) => {
        inserts.push(row);
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
  cachedRows = [];
  inserts.length = 0;
  logDose.mockClear();
});

describe("runCommands", () => {
  it("fresh log_dose command calls logDose with the mapped args and stores the result in apiCommands", async () => {
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

    expect(inserts).toEqual([{ userId: "u1", idempotencyKey: "cmd-1", result: { id: "dose-1" } }]);

    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-1" } }]);
  });

  it("replays a cached (userId, id) pair without re-executing the handler", async () => {
    cachedRows = [{ result: { id: "dose-cached" } }];
    const commands = [{ id: "cmd-1", type: "log_dose", payload: { medicationId: "med-1" } }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
    expect(results).toEqual([{ id: "cmd-1", ok: true, result: { id: "dose-cached" } }]);
  });

  it("captures an unknown command type as ok:false without aborting the batch", async () => {
    const commands = [{ id: "cmd-1", type: "not_a_real_command", payload: {} }];

    const results = await runCommands("u1", commands);

    expect(logDose).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
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
