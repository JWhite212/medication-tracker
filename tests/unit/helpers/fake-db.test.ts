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
