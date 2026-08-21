// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { users, doseLogs } from "../../../src/lib/server/db/schema";
import { pgDb } from "./pg-db";

describe("pg-db harness", () => {
  it("applies every migration, so the schema's tables exist", async () => {
    const res = await pgDb.client.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    const names = res.rows.map((r) => r.tablename);
    // A representative slice across several migrations, not an exhaustive
    // list — an exhaustive one would need editing on every future migration.
    expect(names).toEqual(
      expect.arrayContaining([
        "users",
        "medications",
        "dose_logs",
        "rate_limits",
        "reminder_events",
        "medication_schedules",
        "inventory_events",
      ]),
    );
  });

  it("resolves a named IANA timezone (gates the analytics work)", async () => {
    const rows = await pgDb.db.execute(
      sql`select (timestamptz '2026-06-01 23:30:00+00' AT TIME ZONE 'Europe/London')::text as local`,
    );
    // 23:30 UTC on 1 June is 00:30 on 2 June in BST (UTC+1).
    expect((rows.rows[0] as { local: string }).local).toContain("2026-06-02 00:30");
  });

  it("returns numeric columns as strings, as the Neon driver does", async () => {
    const rows = await pgDb.db.execute(sql`select (1.5)::numeric as n`);
    expect(typeof (rows.rows[0] as { n: unknown }).n).toBe("string");
  });
});

describe("pg-db fixtures", () => {
  beforeEach(async () => {
    await pgDb.reset();
  });

  it("seeds a user, medication and dose that satisfy the foreign keys", async () => {
    await pgDb.seedUser();
    await pgDb.seedMedication();
    await pgDb.seedDose();

    const rows = await pgDb.db.select().from(doseLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u1");
    expect(rows[0].medicationId).toBe("m1");
  });

  it("rejects a dose whose medication does not exist", async () => {
    await pgDb.seedUser();
    // No medication seeded — the FK must reject this. The old fake
    // accepted anything, which is exactly the fidelity this buys.
    await expect(pgDb.seedDose({ medicationId: "nope" })).rejects.toThrow();
  });

  it("reset() empties every table between tests", async () => {
    await pgDb.seedUser();
    await pgDb.reset();
    const rows = await pgDb.db.select().from(users);
    expect(rows).toHaveLength(0);
  });
});
