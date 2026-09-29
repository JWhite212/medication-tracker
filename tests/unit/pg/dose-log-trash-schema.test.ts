// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";

/**
 * Migration 0021 creates `dose_log_trash` wherever tests or `drizzle-kit
 * migrate` run: PGlite applies the SQL in `drizzle/` in journal order and
 * silently skips a file with no journal entry. `schema.ts` cannot prove any of
 * this. These cases pin what the generated SQL must contain: the columns in
 * order with their types and nullability, the primary key, both `ON DELETE
 * cascade`s and the purge index.
 *
 * The cascades are load-bearing. Three paths delete a medication or a user
 * without knowing the trash exists: the archived-medication wipe, import
 * replace mode and account deletion. Each relies on the database to take the
 * trash rows with it.
 *
 * No `vi.mock("$lib/server/db")` here: this file calls no production module,
 * only the PGlite instance itself.
 */

import { asc, eq } from "drizzle-orm";
import { pgDb } from "../helpers/pg-db";
import { doseLogTrash, medications, users } from "../../../src/lib/server/db/schema";

async function trashIds(): Promise<string[]> {
  const rows = await pgDb.db
    .select({ id: doseLogTrash.id })
    .from(doseLogTrash)
    .orderBy(asc(doseLogTrash.id));
  return rows.map((r) => r.id);
}

beforeEach(async () => {
  await pgDb.reset();
});

describe("migration 0021: dose_log_trash", () => {
  it("creates the table with the schema's columns, in order, and no defaults", async () => {
    // No defaults, on purpose. A trash row is a copy, so a NOT NULL field the
    // copy forgot must fail the insert rather than be invented.
    const res = await pgDb.client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      column_default: string | null;
    }>(
      `select column_name, data_type, is_nullable, column_default
       from information_schema.columns
       where table_schema = 'public' and table_name = 'dose_log_trash'
       order by ordinal_position`,
    );
    const col = (column_name: string, data_type: string, nullable: boolean) => ({
      column_name,
      data_type,
      is_nullable: nullable ? "YES" : "NO",
      column_default: null,
    });
    expect(res.rows).toEqual([
      col("id", "text", false),
      col("user_id", "text", false),
      col("medication_id", "text", false),
      col("quantity", "integer", false),
      col("inventory_applied", "integer", true),
      col("inventory_credited", "integer", false),
      col("taken_at", "timestamp with time zone", false),
      col("logged_at", "timestamp with time zone", false),
      col("notes", "text", true),
      col("side_effects", "jsonb", true),
      col("status", "text", false),
      col("deleted_at", "timestamp with time zone", false),
    ]);
  });

  it("keys the table on the dose's own id", async () => {
    const res = await pgDb.client.query<{ attname: string }>(
      `select a.attname
       from pg_index i
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = 'dose_log_trash'::regclass and i.indisprimary`,
    );
    expect(res.rows).toEqual([{ attname: "id" }]);
  });

  it("cascades both foreign keys on delete", async () => {
    const res = await pgDb.client.query<{
      conname: string;
      confdeltype: string;
      references_table: string;
    }>(
      `select conname, confdeltype, confrelid::regclass::text as references_table
       from pg_constraint
       where conrelid = 'dose_log_trash'::regclass and contype = 'f'
       order by conname`,
    );
    // confdeltype 'c' is CASCADE. 'a' is NO ACTION, the default when the
    // clause is missing.
    expect(res.rows).toEqual([
      {
        conname: "dose_log_trash_medication_id_medications_id_fk",
        confdeltype: "c",
        references_table: "medications",
      },
      {
        conname: "dose_log_trash_user_id_users_id_fk",
        confdeltype: "c",
        references_table: "users",
      },
    ]);
  });

  it("indexes (user_id, deleted_at) for the purges", async () => {
    const res = await pgDb.client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef
       from pg_indexes
       where schemaname = 'public' and tablename = 'dose_log_trash'
       order by indexname`,
    );
    expect(res.rows).toEqual([
      {
        indexname: "dose_log_trash_pkey",
        indexdef:
          "CREATE UNIQUE INDEX dose_log_trash_pkey ON public.dose_log_trash USING btree (id)",
      },
      {
        indexname: "dose_log_trash_user_deleted_idx",
        indexdef:
          "CREATE INDEX dose_log_trash_user_deleted_idx ON public.dose_log_trash USING btree (user_id, deleted_at)",
      },
    ]);
  });
});

describe("dose_log_trash cascades", () => {
  it("deleting a medication removes its trash rows and no others (archived wipe, import replace)", async () => {
    await pgDb.seedUser();
    await pgDb.seedMedication({ id: "m1", name: "Paracetamol" });
    await pgDb.seedMedication({ id: "m2", name: "Ibuprofen" });
    await pgDb.seedTrash({ id: "d1", medicationId: "m1" });
    await pgDb.seedTrash({ id: "d2", medicationId: "m2" });

    await pgDb.db.delete(medications).where(eq(medications.id, "m1"));

    expect(await trashIds()).toEqual(["d2"]);
  });

  it("deleting a user removes all of their trash rows and no one else's (account deletion)", async () => {
    await pgDb.seedUser({ id: "u1" });
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m1", userId: "u1" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "d1", userId: "u1", medicationId: "m1" });
    await pgDb.seedTrash({ id: "d2", userId: "u2", medicationId: "m2" });

    // What `settings/data`'s account deletion runs.
    await pgDb.db.delete(users).where(eq(users.id, "u1"));

    expect(await trashIds()).toEqual(["d2"]);
  });
});
