import { getTableName, type Table } from "drizzle-orm";

export type Row = Record<string, unknown>;

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

export function createFakeDb() {
  const seeded = new Map<string, Row[]>();

  /** Every step of a Drizzle chain is both chainable and awaitable:
      production code sometimes awaits `.where(...)` directly and sometimes
      calls `.limit(...)` on it. */
  function selectChain(table: string) {
    const rows = () => seeded.get(table) ?? [];
    const chain = {
      from: (t: unknown) => selectChain(nameOf(t)),
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: (n: number) => Promise.resolve(rows().slice(0, n)),
      then: (onFulfilled: (v: Row[]) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(rows()).then(onFulfilled, onRejected),
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

    reset() {
      seeded.clear();
    },
  };
}
