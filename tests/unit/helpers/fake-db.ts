import { getTableName, type Table } from "drizzle-orm";

export type Row = Record<string, unknown>;

export interface RecordedCall {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  /** Verbatim argument to `.where(...)`; undefined when the call had none. */
  predicate?: unknown;
  /** `.values(...)` for an insert, `.set(...)` for an update. */
  payload?: Row | Row[];
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

  function record(call: RecordedCall) {
    attempted.push(call);
    committed.push(call);
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
      return seeded.get(table) ?? [];
    };

    const chain = {
      from: (t: unknown) => selectChain(nameOf(t)),
      where: (p?: unknown) => {
        predicate = p;
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
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
    let recorded = false;

    const resolve = <T>(value: T): Promise<T> => {
      if (!recorded) {
        recorded = true;
        record({ op, table, predicate, payload });
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
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: () => chain,
      /** A real write materialises the row, so a later read sees it. Model
          that by returning whatever the table is seeded with — without it,
          `preferences.test.ts`'s before-image comes back undefined. */
      returning: () => resolve(seeded.get(table) ?? []),
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

    get attempted(): readonly RecordedCall[] {
      return attempted;
    },

    get committed(): readonly RecordedCall[] {
      return committed;
    },

    reset() {
      seeded.clear();
      attempted.length = 0;
      committed.length = 0;
    },
  };
}

/** The shape every consumer sees, including `dbTx.transaction`'s callback. */
export type FakeClient = ReturnType<typeof createFakeDb>["db"];
