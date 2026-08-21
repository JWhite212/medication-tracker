import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../../../src/lib/server/db/schema";

/** One PGlite per test FILE. Vitest's default `isolate: true` gives each
    file its own module registry, so this module-level instance is not
    shared across the suite — the same property that makes `fakeDb` a safe
    singleton in fake-db.ts. */
export const client = await PGlite.create();

const database = drizzle(client, { schema });

// Apply the real migrations. This also makes the migration files
// themselves tested — nothing else in the repo verifies they apply
// cleanly in journal order.
await migrate(database, { migrationsFolder: "drizzle" });

/** Empty every table without dropping the schema. Called from beforeEach.
    CASCADE is required because dose_logs and reminder_events carry FK
    references to users and medications. */
export async function reset(): Promise<void> {
  const res = await client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = res.rows.map((r) => `"${r.tablename}"`);
  if (names.length === 0) return;
  await client.exec(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE;`);
}

/** Mirrors fake-db.ts's export shape so a test swaps one vi.mock line.
    Production splits `db` (neon-http, no transactions) from `dbTx`
    (neon-serverless, transactions); PGlite serves both from one instance,
    so a test cannot catch "used a transaction on db". Documented in the
    spec as an accepted fidelity loss. */
export const dbMock = { db: database, dbTx: database };

export const pgDb = { client, db: database, reset };
