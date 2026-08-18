import { getTableName, type Table } from "drizzle-orm";

export type Row = Record<string, unknown>;

export interface RecordedCall {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  /** Verbatim argument to `.where(...)`; undefined when the call had none. */
  predicate?: unknown;
  /** `.values(...)` for an insert, `.set(...)` for an update. */
  payload?: Row | Row[];
  /** The config handed to `.onConflictDoUpdate(...)`. This is the upsert's
      target and set clause — for `claimReminderSlot` it IS the dedupe
      mechanism, so it is part of the write's shape, not incidental. */
  conflict?: Row | null;
}

/** Resolve a Drizzle table reference to its SQL name. Falls back to a
    sentinel rather than throwing, so an unexpected argument surfaces as an
    empty result the test can see instead of an exception mid-chain. */
function nameOf(table: unknown): string {
  try {
    return getTableName(table as Table);
  } catch {
    return "<unknown-table>";
  }
}

/** Substring-match against a stringified Drizzle predicate. Drizzle column
    nodes hold a back-pointer to their table, so the replacer must drop
    already-seen objects or JSON.stringify throws on the cycle. */
export function predicateIncludes(predicate: unknown, needle: string): boolean {
  if (predicate === undefined || predicate === null) return false;
  const seen = new WeakSet<object>();
  const json = JSON.stringify(predicate, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value as object)) return undefined;
      seen.add(value as object);
    }
    return value;
  });
  return (json ?? "").includes(needle);
}

export function createFakeDb() {
  const seeded = new Map<string, Row[]>();

  /** Two views of the same traffic, because the existing tests need both.
      `attempted` is append-only — how far execution got before a throw, which
      is what `doses-inventory.test.ts` asserts on. `committed` is reverted
      when a transaction callback throws — what a database would show
      afterwards, which is what `createMedicationWithSchedules.test.ts`
      asserts on. */
  const attempted: RecordedCall[] = [];
  const committed: RecordedCall[] = [];

  /** Per-table result queues, for callers that need successive reads of the
      same table to differ. Drained before the standing seed is consulted. */
  const queued = new Map<string, Row[][]>();

  /** What `.returning()` hands back, when it must differ from what a plain
      read returns. `UPDATE ... RETURNING` yields the row's AFTER image while
      a preceding SELECT saw the BEFORE image, and `updatePreferences` diffs
      one against the other — collapsing them would erase the distinction its
      audit tests exist to check. Unset falls back to the standing seed, which
      models an insert materialising the row. */
  const returningRows = new Map<string, Row[]>();

  /** At most one pending failure per operation, matched on table when one was
      given, consumed on first match. */
  const pendingFailures = new Map<RecordedCall["op"], { table?: string; error: Error }>();

  function record(call: RecordedCall) {
    attempted.push(call);
    committed.push(call);
  }

  function rowsFor(table: string): Row[] {
    const queue = queued.get(table);
    if (queue && queue.length > 0) return queue.shift() as Row[];
    return seeded.get(table) ?? [];
  }

  function takeFailure(op: RecordedCall["op"], table: string): Error | null {
    const pending = pendingFailures.get(op);
    if (!pending) return null;
    if (pending.table !== undefined && pending.table !== table) return null;
    pendingFailures.delete(op);
    return pending.error;
  }

  /** Every step of a Drizzle chain is both chainable and awaitable:
      production code sometimes awaits `.where(...)` directly and sometimes
      calls `.limit(...)` on it. A select records exactly once, on
      resolution, carrying whatever predicate `.where(...)` captured. */
  function selectChain(table: string) {
    let predicate: unknown;
    let recorded = false;

    const resolve = (): Row[] => {
      if (!recorded) {
        recorded = true;
        record({ op: "select", table, predicate });
      }
      return rowsFor(table);
    };

    const chain = {
      from: (t: unknown) => selectChain(nameOf(t)),
      where: (p?: unknown) => {
        predicate = p;
        return chain;
      },
      // Variadic: real callers pass a table and an ON condition to the joins,
      // and one or more columns to groupBy/orderBy. The fake ignores them —
      // it dispatches on the table given to .from() — but the arity has to
      // match or migrated tests fail to type-check.
      innerJoin: (..._args: unknown[]) => chain,
      leftJoin: (..._args: unknown[]) => chain,
      groupBy: (..._args: unknown[]) => chain,
      orderBy: (..._args: unknown[]) => chain,
      limit: (n: number) => Promise.resolve(resolve().slice(0, n)),
      then: (onFulfilled: (v: Row[]) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected),
    };
    return chain;
  }

  /** Writes record exactly once at resolution, and are awaitable at every
      step because callers differ: `logAudit` awaits `.values(...)` directly,
      while `createMedicationWithSchedules` calls `.returning()`. */
  function writeChain(op: RecordedCall["op"], table: string) {
    let payload: Row | Row[] | undefined;
    let predicate: unknown;
    let conflict: Row | null = null;
    let recorded = false;
    let pendingRejection: Error | null = null;

    const resolve = <T>(value: T): Promise<T> => {
      if (!recorded) {
        recorded = true;
        const call: RecordedCall = { op, table, predicate, payload, conflict };
        // The write was tried, so it is always `attempted` — that is what
        // `doses-inventory.test.ts` asserts after a simulated failure.
        attempted.push(call);
        const failure = takeFailure(op, table);
        if (failure) {
          // ...but a rejected write never lands in `committed`. Transaction
          // rollback alone is not enough: a callback that CATCHES the
          // rejection and completes would otherwise leave a write in the
          // durable view that never succeeded.
          pendingRejection = failure;
        } else {
          committed.push(call);
        }
      }
      if (pendingRejection) {
        const failure = pendingRejection;
        pendingRejection = null;
        return Promise.reject(failure);
      }
      return Promise.resolve(value);
    };

    const chain = {
      values: (v: Row | Row[]) => {
        payload = v;
        return chain;
      },
      set: (v: Row) => {
        payload = v;
        return chain;
      },
      where: (p?: unknown) => {
        predicate = p;
        return chain;
      },
      onConflictDoNothing: (..._args: unknown[]) => chain,
      onConflictDoUpdate: (config?: Row, ..._rest: unknown[]) => {
        conflict = config ?? null;
        return chain;
      },
      /** `INSERT ... RETURNING` yields the row as materialised, so it reads
          from the standing seed — that is what lets a caller's next read see
          what it just created. `UPDATE ... RETURNING` yields the AFTER image,
          which a test can prime separately with `seedReturning`. Collapsing
          the two would make `getOrCreatePreferences`'s insert hand back the
          update's after-image, and the before/after diff would vanish. */
      returning: (..._args: unknown[]) =>
        resolve(
          op === "update"
            ? (returningRows.get(table) ?? seeded.get(table) ?? [])
            : (seeded.get(table) ?? []),
        ),
      then: (onFulfilled: (v: undefined) => unknown, onRejected?: (e: unknown) => unknown) =>
        resolve(undefined).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const client = {
    select: () => selectChain("<unselected>"),
    insert: (t: unknown) => writeChain("insert", nameOf(t)),
    update: (t: unknown) => writeChain("update", nameOf(t)),
    delete: (t: unknown) => writeChain("delete", nameOf(t)),
  };

  return {
    db: client,

    dbTx: {
      async transaction<T>(cb: (tx: typeof client) => Promise<T>): Promise<T> {
        const mark = committed.length;
        try {
          return await cb(client);
        } catch (err) {
          committed.length = mark; // all-or-nothing, as Postgres would
          throw err;
        }
      },
    },

    seed(table: Table, rows: Row[]) {
      seeded.set(nameOf(table), rows);
    },

    seedQueue(table: Table, batches: Row[][]) {
      queued.set(nameOf(table), [...batches]);
    },

    /** Make `.returning()` yield an after-image distinct from what reads see. */
    seedReturning(table: Table, rows: Row[]) {
      returningRows.set(nameOf(table), rows);
    },

    failNext(op: RecordedCall["op"], opts: { table?: Table; error: Error }) {
      pendingFailures.set(op, {
        table: opts.table === undefined ? undefined : nameOf(opts.table),
        error: opts.error,
      });
    },

    get attempted(): readonly RecordedCall[] {
      return attempted;
    },

    get committed(): readonly RecordedCall[] {
      return committed;
    },

    reset() {
      seeded.clear();
      queued.clear();
      returningRows.clear();
      pendingFailures.clear();
      attempted.length = 0;
      committed.length = 0;
    },
  };
}

/** The shape every consumer sees, including `dbTx.transaction`'s callback. */
export type FakeClient = ReturnType<typeof createFakeDb>["db"];

function throwingProxy(label: string) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        throw new Error(
          `Unexpected ${label}.${String(prop)} — this test mocks the database as unused. ` +
            `If the module under test now queries the database, switch it to createFakeDb().`,
        );
      },
    },
  );
}

/** For modules that import `db` but must never reach it. Any property access
    throws, so an accidental query fails loudly and by name rather than
    silently returning []. Do not "upgrade" these to createFakeDb() — that
    trades a loud failure for a silent one. */
export const unusedDb = {
  db: throwingProxy("db") as FakeClient,
  dbTx: throwingProxy("dbTx") as { transaction: never },
};

/** Per-file singleton. `vi.mock` is hoisted above module-level consts, but ES
    modules resolve to one instance, so a test's mock factory and its body share
    this object without `vi.hoisted`. Vitest's default `isolate: true` gives each
    test file its own module registry, so this is not shared across the suite.

        vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
        import { fakeDb } from "./helpers/fake-db";
*/
export const fakeDb = createFakeDb();
export const dbMock = { db: fakeDb.db, dbTx: fakeDb.dbTx };
