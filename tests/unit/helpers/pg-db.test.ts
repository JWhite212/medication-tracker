// @vitest-environment node
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
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
