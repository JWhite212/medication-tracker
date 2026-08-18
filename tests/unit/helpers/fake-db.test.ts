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
