# Shared Database Seam for Unit Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace twenty-four hand-built, mutually inconsistent Drizzle fakes with one shared, tested `createFakeDb()` seam, without weakening a single existing assertion.

**Architecture:** A test-only helper at `tests/unit/helpers/fake-db.ts` dispatches queries by real table identity (`getTableName` from `drizzle-orm`), captures `where` predicates for assertion, and exposes two views of transactional writes (`attempted`, never rolled back; `committed`, reverted on throw). Production code is not touched at all. Tests reach the helper through a module singleton, which sidesteps `vi.mock` hoisting.

**Tech Stack:** Vitest 4, drizzle-orm 0.45, TypeScript 6, SvelteKit 2.

**Spec:** `docs/superpowers/specs/2026-08-18-db-test-seam-design.md`

## Global Constraints

- **`git diff main..HEAD -- src/` must be empty.** This change touches no production code. Verified as a gate in Task 16.
- **No new runtime or dev dependencies.** `getTableName` already ships in `drizzle-orm`. PGlite is stage 2, a separate PR.
- Suite baseline on `main` (`f806dba`): **807 tests across 66 files**, green in ~6.7s. Every task ends with the full suite green and the test count accounted for.
- All test commands need the CI placeholder: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require'`.
- **`tests/unit/reminders.test.ts` is never migrated.** See spec Decision 6.
- No deleted `expect(...)` lines without written justification in the commit message. Checked in Task 16.
- The helper never evaluates predicates, never filters rows by them, and never orders results. If a task seems to need that, stop — it is stage 2 work.
- TypeScript strict: no `any` in the helper's exported surface. `unknown` plus narrowing.

---

### Task 1: Helper skeleton — table identity, select chain, seed/reset

**Files:**

- Create: `tests/unit/helpers/fake-db.ts`
- Test: `tests/unit/helpers/fake-db.test.ts`

**Interfaces:**

- Consumes: `getTableName`, `Table` from `drizzle-orm`; real tables from `$lib/server/db/schema`.
- Produces: `createFakeDb()` returning `{ db, seed, reset }` for now; `type Row = Record<string, unknown>`. Tasks 2–5 extend the same returned object.

`tests/unit/helpers/fake-db.test.ts` matches `vite.config.ts`'s `include: ["tests/unit/**/*.test.ts"]`, so it runs as part of the suite. `fake-db.ts` does not match and will not be collected.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/helpers/fake-db.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { medications, doseLogs } from "$lib/server/db/schema";
import { createFakeDb } from "./fake-db";

const fake = createFakeDb();
beforeEach(() => fake.reset());

describe("createFakeDb — select", () => {
  it("returns rows seeded for the queried table", async () => {
    fake.seed(medications, [{ id: "m1", name: "Vitamin D" }]);
    const rows = await fake.db.select().from(medications);
    expect(rows).toEqual([{ id: "m1", name: "Vitamin D" }]);
  });

  it("returns an empty array for a table that was never seeded", async () => {
    const rows = await fake.db.select().from(doseLogs);
    expect(rows).toEqual([]);
  });

  it("does not leak rows between tables", async () => {
    fake.seed(medications, [{ id: "m1" }]);
    expect(await fake.db.select().from(doseLogs)).toEqual([]);
  });

  it("is chainable and awaitable at every step", async () => {
    fake.seed(medications, [{ id: "m1" }, { id: "m2" }]);
    expect(await fake.db.select().from(medications).where(undefined)).toHaveLength(2);
    expect(await fake.db.select().from(medications).where(undefined).limit(1)).toHaveLength(1);
    expect(await fake.db.select().from(medications).orderBy(undefined)).toHaveLength(2);
    expect(await fake.db.select().from(medications).innerJoin(doseLogs, undefined)).toHaveLength(2);
    expect(await fake.db.select().from(medications).groupBy(undefined)).toHaveLength(2);
  });

  it("reset() clears seeded rows", async () => {
    fake.seed(medications, [{ id: "m1" }]);
    fake.reset();
    expect(await fake.db.select().from(medications)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/helpers/fake-db.test.ts`
Expected: FAIL — cannot resolve `./fake-db`.

- [ ] **Step 3: Write minimal implementation**

```ts
// tests/unit/helpers/fake-db.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/helpers/fake-db.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the full suite**

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run`
Expected: 812 tests / 67 files (807 + 5 new, 66 + 1 new file).

- [ ] **Step 6: Commit**

```bash
git add tests/unit/helpers/fake-db.ts tests/unit/helpers/fake-db.test.ts
git commit -m "test(fake-db): add the shared seam's select chain and table identity"
```

---

### Task 2: Predicate capture and `predicateIncludes`

**Files:**

- Modify: `tests/unit/helpers/fake-db.ts`
- Test: `tests/unit/helpers/fake-db.test.ts`

**Interfaces:**

- Produces: `predicateIncludes(predicate: unknown, needle: string): boolean`; `type RecordedCall = { op: "select" | "insert" | "update" | "delete"; table: string; predicate?: unknown; payload?: Row | Row[] }`; `fake.attempted: readonly RecordedCall[]`.

The circular-safe replacer is required, not defensive. A naive `JSON.stringify` of a Drizzle predicate throws `Converting circular structure to JSON` on `PgTable → PgText → table`. This was confirmed by probe before the spec was written; the test below pins it.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/helpers/fake-db.test.ts
import { eq, and } from "drizzle-orm";
import { createFakeDb, predicateIncludes } from "./fake-db";

describe("predicateIncludes", () => {
  it("survives the circular structure a naive JSON.stringify chokes on", () => {
    const predicate = eq(medications.userId, "u1");
    expect(() => JSON.stringify(predicate)).toThrow(/circular/i);
    expect(() => predicateIncludes(predicate, "u1")).not.toThrow();
  });

  it("finds a bound parameter value", () => {
    expect(predicateIncludes(eq(medications.userId, "u1"), "u1")).toBe(true);
  });

  it("finds the underlying column name", () => {
    expect(predicateIncludes(eq(medications.userId, "u1"), "user_id")).toBe(true);
  });

  it("returns false for an absent needle", () => {
    expect(predicateIncludes(eq(medications.userId, "u1"), "nonsense")).toBe(false);
  });

  it("returns false for an undefined predicate rather than throwing", () => {
    expect(predicateIncludes(undefined, "user_id")).toBe(false);
  });

  it("sees both sides of a compound predicate", () => {
    const predicate = and(eq(medications.userId, "u1"), eq(medications.id, "m1"));
    expect(predicateIncludes(predicate, "u1")).toBe(true);
    expect(predicateIncludes(predicate, "m1")).toBe(true);
  });
});

describe("createFakeDb — predicate capture", () => {
  const f = createFakeDb();
  beforeEach(() => f.reset());

  it("records the table and predicate of a select", async () => {
    f.seed(medications, []);
    await f.db.select().from(medications).where(eq(medications.userId, "u1"));
    expect(f.attempted).toHaveLength(1);
    expect(f.attempted[0].op).toBe("select");
    expect(f.attempted[0].table).toBe("medications");
    expect(predicateIncludes(f.attempted[0].predicate, "user_id")).toBe(true);
  });

  it("records a select with no where clause, with an undefined predicate", async () => {
    await f.db.select().from(medications);
    expect(f.attempted).toHaveLength(1);
    expect(f.attempted[0].predicate).toBeUndefined();
  });

  it("reset() clears recorded calls", async () => {
    await f.db.select().from(medications).where(eq(medications.id, "m1"));
    f.reset();
    expect(f.attempted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/helpers/fake-db.test.ts`
Expected: FAIL — `predicateIncludes` is not exported; `attempted` is undefined.

- [ ] **Step 3: Write the implementation**

Add to `fake-db.ts`:

```ts
export interface RecordedCall {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  /** Verbatim argument to `.where(...)`; undefined when the call had none. */
  predicate?: unknown;
  /** `.values(...)` for an insert, `.set(...)` for an update. */
  payload?: Row | Row[];
}

/** Substring-match against a stringified Drizzle predicate. Drizzle column
    nodes hold a back-pointer to their table, so the replacer must drop
    already-seen objects or JSON.stringify throws on the cycle. */
export function predicateIncludes(predicate: unknown, needle: string): boolean {
  if (predicate === undefined || predicate === null) return false;
  const seen = new WeakSet<object>();
  const json = JSON.stringify(predicate, (_key, value: unknown) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
  return (json ?? "").includes(needle);
}
```

Inside `createFakeDb`, add `const attempted: RecordedCall[] = []`, record on `.where(...)` and on chain resolution, expose `get attempted() { return attempted }`, and clear it in `reset()`. A select records exactly once — on resolution — carrying whatever predicate `.where(...)` captured:

```ts
function selectChain(table: string) {
  const rows = () => seeded.get(table) ?? [];
  let predicate: unknown;
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    attempted.push({ op: "select", table, predicate });
  };
  const resolve = () => {
    record();
    return rows();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run tests/unit/helpers/fake-db.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Prove the circular-safety test can fail**

Temporarily replace `predicateIncludes`'s body with a naive `JSON.stringify(predicate).includes(needle)` and re-run. Expected: the circular-structure test FAILS with `Converting circular structure to JSON`. Restore the replacer.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/helpers/fake-db.ts tests/unit/helpers/fake-db.test.ts
git commit -m "test(fake-db): capture where predicates and share the circular-safe reader"
```

---

### Task 3: Writes — insert, update, delete

**Files:**

- Modify: `tests/unit/helpers/fake-db.ts`
- Test: `tests/unit/helpers/fake-db.test.ts`

**Interfaces:**

- Produces: `db.insert(t).values(v).onConflictDoNothing().onConflictDoUpdate({...}).returning()`, `db.update(t).set(v).where(p).returning()`, `db.delete(t).where(p)`. All record a `RecordedCall` into `attempted` with `payload` populated.

`.returning()` resolves to the rows seeded for that table, which models "the write materialised the row" — the behaviour `preferences.test.ts` currently hand-rolls so that a caller's subsequent read sees the inserted row.

- [ ] **Step 1: Write the failing test**

```ts
describe("createFakeDb — writes", () => {
  const f = createFakeDb();
  beforeEach(() => f.reset());

  it("records an insert with its values", async () => {
    await f.db.insert(medications).values({ id: "m1", name: "Vitamin D" });
    expect(f.attempted).toEqual([
      {
        op: "insert",
        table: "medications",
        payload: { id: "m1", name: "Vitamin D" },
        predicate: undefined,
      },
    ]);
  });

  it("records a bulk insert as a single call carrying the array", async () => {
    await f.db.insert(doseLogs).values([{ id: "d1" }, { id: "d2" }]);
    expect(f.attempted[0].payload).toEqual([{ id: "d1" }, { id: "d2" }]);
  });

  it("returning() yields the rows seeded for the table", async () => {
    f.seed(medications, [{ id: "m1" }]);
    const out = await f.db.insert(medications).values({ id: "m1" }).returning();
    expect(out).toEqual([{ id: "m1" }]);
  });

  it("passes through onConflictDoNothing and onConflictDoUpdate", async () => {
    f.seed(medications, [{ id: "m1" }]);
    const out = await f.db
      .insert(medications)
      .values({ id: "m1" })
      .onConflictDoNothing()
      .returning();
    expect(out).toEqual([{ id: "m1" }]);
    expect(f.attempted).toHaveLength(1);
  });

  it("records an update with its set payload and predicate", async () => {
    await f.db.update(medications).set({ name: "B12" }).where(eq(medications.id, "m1"));
    expect(f.attempted[0].op).toBe("update");
    expect(f.attempted[0].payload).toEqual({ name: "B12" });
    expect(predicateIncludes(f.attempted[0].predicate, "m1")).toBe(true);
  });

  it("records a delete with its predicate", async () => {
    await f.db.delete(doseLogs).where(eq(doseLogs.id, "d1"));
    expect(f.attempted[0].op).toBe("delete");
    expect(f.attempted[0].table).toBe("dose_logs");
    expect(predicateIncludes(f.attempted[0].predicate, "d1")).toBe(true);
  });

  it("awaiting insert().values(...) directly resolves, for callers that never call returning()", async () => {
    await expect(f.db.insert(medications).values({ id: "m1" })).resolves.toBeUndefined();
    expect(f.attempted).toHaveLength(1);
  });
});
```

The final case matters: `logAudit` awaits `.values(...)` directly without `.returning()`, which `preferences.test.ts` models today with a bespoke `then` on the insert result.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `db.insert is not a function`.

- [ ] **Step 3: Write the implementation**

Each write records exactly once at resolution, mirroring `selectChain`'s record-once discipline, and is awaitable at every step because callers differ: `logAudit` awaits `.values(...)` directly, while `createMedicationWithSchedules` calls `.returning()`.

```ts
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
```

Wire them onto the client alongside `select`:

```ts
const client = {
  select: () => selectChain("<unselected>"),
  insert: (t: unknown) => writeChain("insert", nameOf(t)),
  update: (t: unknown) => writeChain("update", nameOf(t)),
  delete: (t: unknown) => writeChain("delete", nameOf(t)),
};

/** The shape every consumer sees, including `dbTx.transaction`'s callback. */
export type FakeClient = typeof client;
```

`record(call)` is a single internal function — introduced here and extended in Task 4 — that appends to `attempted`. Keeping every write funnelled through it is what makes Task 4's `committed` view a two-line change rather than a rewrite.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, 21 tests.

- [ ] **Step 5: Run the full suite**

Expected: 828 tests / 67 files.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/helpers/fake-db.ts tests/unit/helpers/fake-db.test.ts
git commit -m "test(fake-db): record insert, update and delete traffic"
```

---

### Task 4: Transactions — the `attempted` / `committed` split

**Files:**

- Modify: `tests/unit/helpers/fake-db.ts`
- Test: `tests/unit/helpers/fake-db.test.ts`

**Interfaces:**

- Consumes: `FakeClient` and the internal `record(call)` function, both from Task 3.
- Produces: `fake.dbTx.transaction(cb)`; `fake.committed: readonly RecordedCall[]`.

This is spec Decision 3. Two existing files make contradictory, individually-correct demands: `doses-inventory.test.ts:203` asserts a write survives a rollback (it is testing how far execution got), while `createMedicationWithSchedules.test.ts:140` asserts writes are restored (it is testing all-or-nothing commit). `attempted` serves the first, `committed` the second.

- [ ] **Step 1: Write the failing test**

```ts
describe("createFakeDb — transactions", () => {
  const f = createFakeDb();
  beforeEach(() => f.reset());

  it("commits writes made inside a successful transaction", async () => {
    await f.dbTx.transaction(async (tx) => {
      await tx.insert(medications).values({ id: "m1" });
    });
    expect(f.committed).toHaveLength(1);
    expect(f.attempted).toHaveLength(1);
  });

  it("rolls back committed but preserves attempted when the callback throws", async () => {
    await expect(
      f.dbTx.transaction(async (tx) => {
        await tx.insert(medications).values({ id: "m1" });
        throw new Error("constraint failed");
      }),
    ).rejects.toThrow("constraint failed");

    // What a real database would show afterwards: nothing.
    expect(f.committed).toHaveLength(0);
    // How far execution actually got before the throw.
    expect(f.attempted).toHaveLength(1);
    expect(f.attempted[0].table).toBe("medications");
  });

  it("preserves writes made before the transaction started", async () => {
    await f.db.insert(doseLogs).values({ id: "d1" });
    await expect(
      f.dbTx.transaction(async (tx) => {
        await tx.insert(medications).values({ id: "m1" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(f.committed).toHaveLength(1);
    expect(f.committed[0].table).toBe("dose_logs");
  });

  it("the tx handle reads the same seeded rows as db", async () => {
    f.seed(medications, [{ id: "m1" }]);
    const rows = await f.dbTx.transaction(async (tx) => tx.select().from(medications));
    expect(rows).toEqual([{ id: "m1" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `f.dbTx` is undefined.

- [ ] **Step 3: Write the implementation**

`committed` is a separate array that every write appends to alongside `attempted`. `transaction(cb)` snapshots `committed.length` on entry, invokes `cb` with the same client, and on throw truncates `committed` back to the snapshot before rethrowing. `attempted` is never truncated.

```ts
async transaction<T>(cb: (tx: FakeClient) => Promise<T>): Promise<T> {
  const mark = committed.length;
  try {
    return await cb(client);
  } catch (err) {
    committed.length = mark; // all-or-nothing, as Postgres would
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, 25 tests.

- [ ] **Step 5: Verify the rollback is real**

Temporarily delete the `committed.length = mark` line and re-run. Expected: the rollback test FAILS (`committed` has length 1, not 0). Restore it.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/helpers/fake-db.ts tests/unit/helpers/fake-db.test.ts
git commit -m "test(fake-db): give transactions an attempted and a committed view"
```

---

### Task 5: `seedQueue`, `failNext`, `unusedDb`, and the mock entry point

**Files:**

- Modify: `tests/unit/helpers/fake-db.ts`
- Test: `tests/unit/helpers/fake-db.test.ts`

**Interfaces:**

- Produces: `seedQueue(table, batches)`, `failNext(op, { table?, error })`, `unusedDb`, and the singleton pair `fakeDb` / `dbMock` used by migrated tests.

Spec Decision 3a: `unusedDb` preserves the loud-failure property of `db: {}` rather than replacing it with a fake that silently returns `[]`.

Spec Decision 5: migrated tests use the module singleton, which sidesteps `vi.mock` hoisting because ES modules resolve to one instance:

```ts
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
import { fakeDb } from "./helpers/fake-db";
```

Vitest's default `isolate: true` gives each test file its own module registry, so the singleton is per-file, not shared across the suite.

- [ ] **Step 1: Write the failing test**

```ts
describe("createFakeDb — seedQueue", () => {
  const f = createFakeDb();
  beforeEach(() => f.reset());

  it("serves successive selects from the queue in order", async () => {
    f.seedQueue(medications, [[{ id: "m1" }], [{ id: "m2" }]]);
    expect(await f.db.select().from(medications)).toEqual([{ id: "m1" }]);
    expect(await f.db.select().from(medications)).toEqual([{ id: "m2" }]);
  });

  it("falls back to an empty array once the queue is drained", async () => {
    f.seedQueue(medications, [[{ id: "m1" }]]);
    await f.db.select().from(medications);
    expect(await f.db.select().from(medications)).toEqual([]);
  });

  it("a queue takes precedence over a standing seed for the same table", async () => {
    f.seed(medications, [{ id: "standing" }]);
    f.seedQueue(medications, [[{ id: "queued" }]]);
    expect(await f.db.select().from(medications)).toEqual([{ id: "queued" }]);
    expect(await f.db.select().from(medications)).toEqual([{ id: "standing" }]);
  });
});

describe("createFakeDb — failNext", () => {
  const f = createFakeDb();
  beforeEach(() => f.reset());

  it("rejects the next matching write and then stops", async () => {
    f.failNext("update", { table: medications, error: new Error("simulated update failure") });
    await expect(f.db.update(medications).set({ name: "x" }).where(undefined)).rejects.toThrow(
      "simulated update failure",
    );
    await expect(
      f.db.update(medications).set({ name: "y" }).where(undefined),
    ).resolves.not.toThrow();
  });

  it("records the failed call in attempted — the write was tried", async () => {
    f.failNext("insert", { table: medications, error: new Error("boom") });
    await expect(f.db.insert(medications).values({ id: "m1" })).rejects.toThrow("boom");
    expect(f.attempted).toHaveLength(1);
  });

  it("leaves other tables alone", async () => {
    f.failNext("insert", { table: medications, error: new Error("boom") });
    await expect(f.db.insert(doseLogs).values({ id: "d1" })).resolves.not.toThrow();
  });
});

describe("unusedDb", () => {
  it("throws by name when a supposedly-unused db is touched", async () => {
    const { unusedDb } = await import("./fake-db");
    expect(() => unusedDb.db.select()).toThrow(/select/);
  });
});
```

The third `failNext` case and the `attempted` case both matter: `doses-inventory.test.ts` needs a failure scoped to `medications` while other writes proceed, and needs the failed write to still appear as attempted.

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — `seedQueue`, `failNext`, `unusedDb` are not defined.

- [ ] **Step 3: Write the implementation**

```ts
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
    silently returning []. */
export const unusedDb = {
  db: throwingProxy("db"),
  dbTx: throwingProxy("dbTx"),
};

/** Per-file singleton. Vitest isolates each test file's module registry, so
    this is not shared across the suite. */
export const fakeDb = createFakeDb();
export const dbMock = { db: fakeDb.db, dbTx: fakeDb.dbTx };
```

`seedQueue` stores `Row[][]` per table and `shift()`s on each select, falling back to the standing seed and then to `[]`:

```ts
const queued = new Map<string, Row[][]>();

function rowsFor(table: string): Row[] {
  const queue = queued.get(table);
  if (queue && queue.length > 0) return queue.shift() as Row[];
  return seeded.get(table) ?? [];
}

// in the returned object:
seedQueue(table: Table, batches: Row[][]) {
  queued.set(nameOf(table), [...batches]);
},
```

Replace `selectChain`'s `seeded.get(table) ?? []` with `rowsFor(table)`.

`failNext` holds at most one pending failure per operation, matched on table when one is given, consumed on first match, and thrown **after** the call is recorded — a write that was attempted and rejected still happened:

```ts
const pendingFailures = new Map<RecordedCall["op"], { table?: string; error: Error }>();

function takeFailure(op: RecordedCall["op"], table: string): Error | null {
  const pending = pendingFailures.get(op);
  if (!pending) return null;
  if (pending.table !== undefined && pending.table !== table) return null;
  pendingFailures.delete(op);
  return pending.error;
}

// in the returned object:
failNext(op: RecordedCall["op"], opts: { table?: Table; error: Error }) {
  pendingFailures.set(op, {
    table: opts.table === undefined ? undefined : nameOf(opts.table),
    error: opts.error,
  });
},
```

In `writeChain`'s `resolve`, after recording, check for a failure and reject:

```ts
const resolve = <T>(value: T): Promise<T> => {
  if (!recorded) {
    recorded = true;
    record({ op, table, predicate, payload });
  }
  const failure = takeFailure(op, table);
  return failure ? Promise.reject(failure) : Promise.resolve(value);
};
```

`reset()` must clear `queued` and `pendingFailures` as well as `seeded`, `attempted` and `committed`.

- [ ] **Step 4: Run test to verify it passes**

Expected: PASS, 32 tests.

- [ ] **Step 5: Run the full suite and lint**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run
npx eslint tests/unit/helpers/fake-db.ts tests/unit/helpers/fake-db.test.ts
npx svelte-check --threshold error 2>&1 | tail -5
```

Expected: 839 tests / 67 files; no lint errors; no new type errors.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/helpers/fake-db.ts tests/unit/helpers/fake-db.test.ts
git commit -m "test(fake-db): add queued seeds, failure injection and the unused-db stub"
```

---

### Task 6: Pilot migration — `api/sync.test.ts`

**Files:**

- Modify: `tests/unit/api/sync.test.ts`

**Interfaces:**

- Consumes: `fakeDb`, `dbMock` from Task 5.

`api/sync.test.ts` is the pilot because its hand-rolled fake is already the closest to the design — it maps table refs to names and seeds per table. If the helper cannot serve this file, the design is wrong and the remaining tasks should stop.

Note the import path from `tests/unit/api/` is `../helpers/fake-db`, not `./helpers/fake-db`.

- [ ] **Step 1: Record the pre-migration baseline**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' \
  npx vitest run tests/unit/api/sync.test.ts --reporter=verbose > /tmp/sync-before.txt
grep -c '✓' /tmp/sync-before.txt
```

Record the exact test names and count. They must be identical after migration.

- [ ] **Step 2: Delete the schema mock and the hand-rolled fake**

Remove the `tableNames` Map, the seven-entry `vi.mock("$lib/server/db/schema", ...)`, `awaitableRows`, `buildDb`, and the `seeded` record. Replace with:

```ts
vi.mock("$lib/server/db", async () => (await import("../helpers/fake-db")).dbMock);

import { fakeDb } from "../helpers/fake-db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
  userPreferences,
  users,
  syncTombstones,
} from "$lib/server/db/schema";
```

Each `seeded = { medications: [...] }` assignment becomes `fakeDb.seed(medications, [...])`, and `beforeEach` calls `fakeDb.reset()`.

- [ ] **Step 3: Run the file and compare against the baseline**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' \
  npx vitest run tests/unit/api/sync.test.ts --reporter=verbose > /tmp/sync-after.txt
diff <(grep '✓\|×' /tmp/sync-before.txt) <(grep '✓\|×' /tmp/sync-after.txt)
```

Expected: empty diff — same test names, same order, all passing.

- [ ] **Step 4: Mutation check — prove the migrated tests can still fail**

In `src/lib/server/api/sync.ts`, break the response assembly (for example, return an empty array where medications are collected). Re-run the file.
Expected: FAIL. Revert the break and confirm green again.

**If the tests stay green against broken production code, the migration silently weakened them. Stop and investigate before continuing.**

- [ ] **Step 5: Commit**

```bash
git add tests/unit/api/sync.test.ts
git commit -m "test(sync): take the database fake from the shared seam"
```

---

### Task 7: Table-identity wave, part 1 — `preferences`, `auth-reauth`, `api/wipe`

**Files:**

- Modify: `tests/unit/preferences.test.ts`, `tests/unit/auth-reauth.test.ts`, `tests/unit/api/wipe.test.ts`

Each of these already dispatches by table identity, so migration is a substitution rather than a redesign. `preferences.test.ts` additionally relies on an insert materialising the row so a later read sees it — Task 3's `returning()` behaviour covers this, but verify explicitly, because its comment calls out that without it "the before-image comes back undefined in the row-absent case".

- [ ] **Step 1: Record baselines for all three files**

Same procedure as Task 6, Step 1, one capture per file.

- [ ] **Step 2: Migrate `preferences.test.ts`**

Delete `buildChainable`, `storedRow`, `updatedRow`, `inserts`, `updates`. Seed `userPreferences` and read writes from `fakeDb.attempted`. Keep every existing assertion verbatim — in particular the four scoping tests that pin the audit diff to `Object.keys(updates)`.

- [ ] **Step 3: Run, diff against baseline, and mutation-check**

Break `updatePreferences` to diff the whole row instead of the submitted keys. Expected: the four scoping tests FAIL. Revert.

This is the exact break PR #113 used to prove those tests work; it must still fail after migration.

- [ ] **Step 4: Migrate `auth-reauth.test.ts` and `api/wipe.test.ts`, repeating Steps 1–3**

For `api/wipe.test.ts`, mutation-check by making the wipe skip one table; expected FAIL on the table-coverage assertions.

- [ ] **Step 5: Run the full suite**

Expected: 839 tests / 67 files, unchanged.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/preferences.test.ts tests/unit/auth-reauth.test.ts tests/unit/api/wipe.test.ts
git commit -m "test(preferences,auth,wipe): take the database fake from the shared seam"
```

---

### Task 8: The transaction quintet

**Files:**

- Modify: `tests/unit/createMedicationWithSchedules.test.ts`, `tests/unit/updateMedicationWithSchedules.test.ts`, `tests/unit/doses-inventory.test.ts`, `tests/unit/import-apply.test.ts`, `tests/unit/inventory-events.test.ts`

This is the task that exercises spec Decision 3, and the one most likely to expose a design flaw. Migrate `createMedicationWithSchedules.test.ts` and `doses-inventory.test.ts` **first and together**, because they are the pair with contradictory demands.

- [ ] **Step 1: Record baselines for all five files**

- [ ] **Step 2: Migrate `createMedicationWithSchedules.test.ts` — the `committed` view**

Its rollback assertions read `fakeDb.committed`. Its ordering assertion becomes:

```ts
expect(fakeDb.committed.map((c) => c.table)).toEqual([
  "medications",
  "medication_schedules",
  "audit_logs",
]);
```

Delete its `vi.mock("$lib/server/db/schema", ...)` — the real tables now supply the names.

- [ ] **Step 3: Migrate `doses-inventory.test.ts` — the `attempted` view**

Its "the write was tried before the throw" assertion becomes:

```ts
expect(fakeDb.attempted.some((c) => c.op === "update" && c.table === "medications")).toBe(true);
expect(auditCalls).toEqual([]);
```

`failOnUpdateOf = medications` becomes `fakeDb.failNext("update", { table: medications, error: new Error("simulated update failure") })`.

- [ ] **Step 4: Run both files and mutation-check each**

For `createMedicationWithSchedules`: remove the audit insert from inside the transaction. Expected: the ordering assertion FAILS.
For `doses-inventory`: move `logAudit` outside the transaction. Expected: the "audit not called" assertion FAILS.

Both breaks must fail. If either stays green, the two views are not doing their job.

- [ ] **Step 5: Migrate `updateMedicationWithSchedules.test.ts`, `import-apply.test.ts`, `inventory-events.test.ts`, repeating Steps 1–4**

`inventory-events.test.ts` is the file that dispatches by table for one operation and ignores it for another; after migration it dispatches by table throughout.

- [ ] **Step 6: Run the full suite and commit**

Expected: 839 tests / 67 files, unchanged.

```bash
git add tests/unit/createMedicationWithSchedules.test.ts tests/unit/updateMedicationWithSchedules.test.ts \
        tests/unit/doses-inventory.test.ts tests/unit/import-apply.test.ts tests/unit/inventory-events.test.ts
git commit -m "test(medications,doses,import): take transactional fakes from the shared seam"
```

---

### Task 9: Table-agnostic wave, part 1 — the auth files

**Files:**

- Modify: `tests/unit/auth-login-action.test.ts`, `tests/unit/auth-oauth-callback.test.ts`, `tests/unit/auth-totp.test.ts`, `tests/unit/security-revoke-session.test.ts`

These currently ignore the table argument entirely. Under table-identity dispatch a query against an unseeded table returns `[]` instead of the primed rows, so **each of these will need its seeds spelled out per table**, and that is where genuine setup/production mismatches will surface. Budget more time than the earlier waves.

`auth-oauth-callback.test.ts` and `security-revoke-session.test.ts` also prime results by `.shift()`; those become `fakeDb.seedQueue(table, batches)`.

- [ ] **Step 1: Record baselines for all four files**

- [ ] **Step 2: Migrate one file at a time, running after each**

If a test fails because a table was never seeded, that is information: the test previously received rows for a query it never described. Seed the table it actually reads and note the discrepancy in the commit message.

- [ ] **Step 3: Mutation-check each file**

- `auth-login-action`: make the password comparison always succeed. Expected: the invalid-credentials tests FAIL.
- `auth-totp`: make TOTP verification always succeed. Expected: the rejection tests FAIL.
- `security-revoke-session`: make revocation skip the session delete. Expected: FAIL.
- `auth-oauth-callback`: make the account-link lookup return nothing. Expected: FAIL.

- [ ] **Step 4: Run the full suite and commit**

```bash
git add tests/unit/auth-login-action.test.ts tests/unit/auth-oauth-callback.test.ts \
        tests/unit/auth-totp.test.ts tests/unit/security-revoke-session.test.ts
git commit -m "test(auth): take the database fake from the shared seam"
```

---

### Task 10: Table-agnostic wave, part 2 — the API files

**Files:**

- Modify: `tests/unit/api/2fa.test.ts`, `tests/unit/api/apple-route.test.ts`, `tests/unit/api/commands.test.ts`, `tests/unit/api/login.test.ts`

`api/commands.test.ts` is the largest file in the set at 582 lines and drives everything from module-level `let`s (`reserveResult`, `selectRows`, `inserts`, `updates`, `deletes`, `updateShouldRejectOnce`). Its `apiCommands` schema mock is a single-property stand-in (`{ idempotencyKey: "idempotencyKey" }`) and is deleted in favour of the real table.

`updateShouldRejectOnce` becomes `fakeDb.failNext("update", { error: new Error("result write failed") })` — no table filter, matching today's behaviour of failing whichever update comes next.

- [ ] **Step 1: Record baselines for all four files**

- [ ] **Step 2: Migrate one file at a time, running after each**

- [ ] **Step 3: Mutation-check each file**

- `api/commands`: make the idempotency reserve always report "already reserved". Expected: the replay tests FAIL.
- `api/login`: make the credential check always pass. Expected: FAIL.
- `api/2fa`: make the code check always pass. Expected: FAIL.
- `api/apple-route`: make token verification always pass. Expected: FAIL.

- [ ] **Step 4: Run the full suite and commit**

```bash
git add tests/unit/api/2fa.test.ts tests/unit/api/apple-route.test.ts \
        tests/unit/api/commands.test.ts tests/unit/api/login.test.ts
git commit -m "test(api): take the database fake from the shared seam"
```

---

### Task 11: Table-agnostic wave, part 3 — the remainder

**Files:**

- Modify: `tests/unit/interactions.test.ts`, `tests/unit/schedules-server.test.ts`, `tests/unit/reminders-dispatch.test.ts`, `tests/unit/analytics-legacy-interval.test.ts`, `tests/unit/push-test-notification.test.ts`

`reminders-dispatch.test.ts` carries the second copy of `chunksContain`; **delete it and import `predicateIncludes`**. Its four `chunksContain(setWhere, ...)` assertions become `predicateIncludes(...)` with identical arguments and identical expectations.

`push-test-notification.test.ts` primes by `.shift()` off `selectQueue` and counts deletes with `deleteCount`; those become `fakeDb.seedQueue(...)` and a filter over `fakeDb.attempted` for `op === "delete"`.

- [ ] **Step 1: Record baselines for all five files**

- [ ] **Step 2: Migrate one file at a time, running after each**

- [ ] **Step 3: Mutation-check each file**

- `reminders-dispatch`: break `completeReminder` so it never writes the terminal status. Expected: FAIL.
- `schedules-server`: make schedule replacement skip the delete. Expected: FAIL.
- `interactions`: make the interaction lookup return nothing. Expected: FAIL.
- `analytics-legacy-interval`: revert the `intervalDosesPerDay` guard so a stored `"0"` yields `Infinity`. Expected: FAIL (this is PR #116's pinned defect).
- `push-test-notification`: make the send skip stale-subscription cleanup. Expected: the delete-count assertion FAILS.

- [ ] **Step 4: Confirm `chunksContain` now exists in exactly one place**

```bash
grep -rn "chunksContain" tests/unit
```

Expected: matches only in `tests/unit/reminders.test.ts`, which keeps its bespoke fake by design.

- [ ] **Step 5: Run the full suite and commit**

```bash
git add tests/unit/interactions.test.ts tests/unit/schedules-server.test.ts \
        tests/unit/reminders-dispatch.test.ts tests/unit/analytics-legacy-interval.test.ts \
        tests/unit/push-test-notification.test.ts
git commit -m "test(reminders,schedules,push): take the database fake from the shared seam"
```

---

### Task 12: `export-pdf-report.test.ts` — call index to table identity

**Files:**

- Modify: `tests/unit/export-pdf-report.test.ts`

Spec Decision 6's migrating half. Its fake is `select: () => chain([doseRows, medRows][queryIndex++] ?? [])`. `queryIndex` appears in no assertion — it exists only to deliver the right rows to the right query — and the two queries read different tables (`dose_logs`, `medications`). Table-identity dispatch delivers the same rows without depending on order.

- [ ] **Step 1: Record the baseline**

- [ ] **Step 2: Replace the index dispatch with per-table seeds**

```ts
fakeDb.seed(doseLogs, doseRows);
fakeDb.seed(medications, medRows);
```

Delete `queryIndex`, the `chain` helper, and the `queryIndex = 0` reset in `beforeEach`.

- [ ] **Step 3: Run and diff against the baseline**

Expected: empty diff.

- [ ] **Step 4: Mutation-check**

Break `buildPdfReport` so the medication name is omitted from each row. Expected: FAIL.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/export-pdf-report.test.ts
git commit -m "test(export-pdf-report): dispatch by table instead of call order"
```

---

### Task 13: The nine trivial stubs

**Files:**

- Modify: `tests/unit/analytics.test.ts`, `tests/unit/audit.test.ts`, `tests/unit/export-csv.test.ts`, `tests/unit/export-pdf.test.ts`, `tests/unit/import-csv.test.ts`, `tests/unit/import-round-trip.test.ts`, `tests/unit/inventory.test.ts`, `tests/unit/log-dose-actions.test.ts`, `tests/unit/medication-stats.test.ts`

Spec Decision 3a. These use `unusedDb`, **not** `createFakeDb()` — the whole point is to keep an accidental query loud.

- [ ] **Step 1: Replace each stub**

```ts
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
```

`log-dose-actions.test.ts` also carries `vi.mock("$lib/server/db/schema", () => ({ doseLogs: {}, medications: {} }))` — delete it; the real schema is now importable.

`medication-stats.test.ts` mocks `{ db: {}, dbTx: {} }`; `unusedDb` supplies both.

- [ ] **Step 2: Run the full suite**

Expected: 839 tests / 67 files, all green. If any file now throws `Unexpected db.<prop>`, that file was reaching the database after all — a genuine finding. Move it to `createFakeDb()` and note it in the commit message.

- [ ] **Step 3: Verify no bare stubs remain**

```bash
grep -rn 'vi.mock(.*db", () => ({ db: {}' tests/unit
```

Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/analytics.test.ts tests/unit/audit.test.ts tests/unit/export-csv.test.ts \
        tests/unit/export-pdf.test.ts tests/unit/import-csv.test.ts tests/unit/import-round-trip.test.ts \
        tests/unit/inventory.test.ts tests/unit/log-dose-actions.test.ts tests/unit/medication-stats.test.ts
git commit -m "test: mark the database as unused where no query runs"
```

---

### Task 14: The `user_id` scoping assertions

**Files:**

- Modify: `tests/unit/api/sync.test.ts`, `tests/unit/preferences.test.ts`, `tests/unit/api/wipe.test.ts`, `tests/unit/interactions.test.ts`, `tests/unit/schedules-server.test.ts`

The spec's security section, bounded deliberately: no new test files and no new fixtures, only an assertion appended to reads that already execute. CLAUDE.md states _"All DB queries scoped by `user_id`"_ and until now nothing verified it.

- [ ] **Step 1: Add one scoping assertion per user-scoped read**

```ts
it("scopes every read to the requesting user", async () => {
  await buildSyncResponse("u1", 0);
  const reads = fakeDb.attempted.filter((c) => c.op === "select");
  expect(reads.length).toBeGreaterThan(0);
  for (const read of reads) {
    expect(predicateIncludes(read.predicate, "user_id")).toBe(true);
  }
});
```

- [ ] **Step 2: Run and confirm each new assertion passes**

If one fails, **do not weaken the assertion.** A read that is not user-scoped is either a genuine defect — stop, report it, and fix it on its own branch — or a legitimately global read, in which case exclude that specific table by name with a comment saying why.

- [ ] **Step 3: Prove the assertions can fail**

Remove the `eq(medications.userId, userId)` term from one production read. Expected: the corresponding scoping assertion FAILS. Revert.

- [ ] **Step 4: Run the full suite and commit**

Expected: 839 + N tests, where N is the number of scoping tests added.

```bash
git add tests/unit/api/sync.test.ts tests/unit/preferences.test.ts tests/unit/api/wipe.test.ts \
        tests/unit/interactions.test.ts tests/unit/schedules-server.test.ts
git commit -m "test: assert that user-scoped reads carry a user_id predicate"
```

---

### Task 15: Document the seam in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the existing database-mocking line**

The current text reads _"Tests that touch the database mock the `db` import (see `tests/unit/csv.test.ts`)"_ — note it references a file that no longer exists. Replace with:

```markdown
- **`tests/unit/helpers/fake-db.ts` owns the database seam for unit tests.** Tests
  mock `$lib/server/db` with `dbMock` and drive it through `fakeDb` — never a
  hand-rolled chainable. It dispatches by real table identity via drizzle's
  `getTableName`, so tests import the **real** schema and no test mocks
  `$lib/server/db/schema`. Writes land in two views: `attempted` is append-only
  (how far execution got), `committed` is rolled back when a `dbTx.transaction`
  callback throws (what a database would show afterwards) — `doses-inventory`
  needs the first, `createMedicationWithSchedules` the second. `where` predicates
  are captured, never evaluated; assert on them with `predicateIncludes`. Modules
  that import `db` but run no query use `unusedDb`, which **throws** on access —
  do not "upgrade" those to `createFakeDb()`, because that turns a loud accidental
  query into a silent `[]`. `tests/unit/reminders.test.ts` keeps a bespoke
  call-index fake on purpose: it asserts on `whereArgsByCall[1]`, and table
  dispatch would delete that assertion while staying green.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the unit-test database seam"
```

---

### Task 16: Final verification gate

**Files:** none modified.

- [ ] **Step 1: Prove no production code changed**

```bash
git diff main..HEAD --stat -- src/
```

Expected: **empty**. Any output is a plan violation — the change is test-only.

- [ ] **Step 2: Prove no assertions were deleted**

```bash
git diff main..HEAD -- tests/ | grep '^-' | grep -v '^---' | grep 'expect('
```

Expected: only lines whose replacement is visible in the same hunk (`chunksContain` → `predicateIncludes` rewrites, and `updates.some(...)` → `fakeDb.attempted.some(...)` rewrites). Any assertion deleted without a replacement must be justified in writing or restored.

- [ ] **Step 3: Confirm the duplication is actually gone**

```bash
grep -rlc 'vi.mock(.*db/schema' tests/unit          # expect: no matches
grep -rl 'vi.mock(.*server/db"' tests/unit | wc -l   # expect: 33
grep -rn 'chunksContain' tests/unit                  # expect: reminders.test.ts only
```

- [ ] **Step 4: Full green run, lint, and types**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run
npx eslint .
npx svelte-check --threshold error
npm run build
```

Expected: all green; test count is 839 plus the Task 14 scoping tests; build succeeds.

- [ ] **Step 5: Confirm coverage thresholds still hold**

```bash
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run --coverage
```

Expected: statements ≥30, branches ≥25, functions ≥25.5, lines ≥30. Coverage is scoped to `src/lib/**`, which this change does not touch, so the numbers should be unchanged rather than merely passing.

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin refactor/db-test-seam
gh pr create --base main --title "refactor(tests): give the database fake one owner" --body "<summary + the Task 16 evidence>"
```

The PR body must state the mutation-check results explicitly. A green suite is not evidence for this change; the record of production code broken and tests failing is.

---

## Notes for the executor

**The single most important thing in this plan is the mutation check.** This project reverted PR #110 because the tests pinning a contract were replaced and the suite stayed green while proving nothing. Here the harness itself is what changes, so green is close to worthless as evidence. A shared fake that is more permissive than the hand-rolled one it replaces will keep every test passing while testing less. Every migration task carries a specific break to apply and a specific failure to observe. If a break does not produce a failure, stop and investigate — do not proceed to the next file.

**Expect the table-agnostic wave (Tasks 9–11) to surface real mismatches.** Those files currently ignore the table argument, so a query against an unseeded table now returns `[]` where it used to return primed rows. Each such failure is a test that was receiving data for a query it never described. Fix the seed, and say so in the commit message.
