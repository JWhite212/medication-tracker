import { describe, it, expect, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { medications, doseLogs } from "$lib/server/db/schema";
import { createFakeDb, predicateIncludes } from "./fake-db";

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

describe("createFakeDb — seedReturning", () => {
  const f = createFakeDb();
  beforeEach(() => f.reset());

  it("keeps the after-image distinct from what reads see", async () => {
    f.seed(medications, [{ id: "m1", name: "before" }]);
    f.seedReturning(medications, [{ id: "m1", name: "after" }]);

    // A read sees the before image...
    expect(await f.db.select().from(medications)).toEqual([{ id: "m1", name: "before" }]);
    // ...while UPDATE ... RETURNING yields the after image.
    const out = await f.db.update(medications).set({ name: "after" }).where(undefined).returning();
    expect(out).toEqual([{ id: "m1", name: "after" }]);
  });

  it("falls back to the standing seed when no after-image is set", async () => {
    f.seed(medications, [{ id: "m1" }]);
    expect(await f.db.insert(medications).values({ id: "m1" }).returning()).toEqual([{ id: "m1" }]);
  });
});

describe("unusedDb", () => {
  it("throws by name when a supposedly-unused db is touched", async () => {
    const { unusedDb } = await import("./fake-db");
    expect(() => unusedDb.db.select()).toThrow(/select/);
  });
});
