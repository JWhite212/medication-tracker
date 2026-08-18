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
  const attempted: RecordedCall[] = [];

  function record(call: RecordedCall) {
    attempted.push(call);
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

  return {
    db: {
      select: () => selectChain("<unselected>"),
    },

    seed(table: Table, rows: Row[]) {
      seeded.set(nameOf(table), rows);
    },

    get attempted(): readonly RecordedCall[] {
      return attempted;
    },

    reset() {
      seeded.clear();
      attempted.length = 0;
    },
  };
}
