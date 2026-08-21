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

/** Fixtures. Defaults satisfy every NOT NULL column so a caller overrides
    only what the test is actually about. Insert order matters: medications
    reference users, dose_logs reference both, and unlike fake-db the real
    database enforces it. */

export async function seedUser(overrides: Partial<typeof schema.users.$inferInsert> = {}) {
  const row: typeof schema.users.$inferInsert = {
    id: "u1",
    email: "u1@example.com",
    name: "Test User",
    ...overrides,
  };
  await database.insert(schema.users).values(row).onConflictDoNothing();
  return row;
}

export async function seedMedication(
  overrides: Partial<typeof schema.medications.$inferInsert> = {},
) {
  const row: typeof schema.medications.$inferInsert = {
    id: "m1",
    userId: "u1",
    name: "Test Med",
    // numeric NOT NULL — Drizzle takes a string here and returns one.
    dosageAmount: "1",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#ffffff",
    ...overrides,
  };
  await database.insert(schema.medications).values(row).onConflictDoNothing();
  return row;
}

let doseSeq = 0;

export async function seedDose(overrides: Partial<typeof schema.doseLogs.$inferInsert> = {}) {
  doseSeq += 1;
  const row: typeof schema.doseLogs.$inferInsert = {
    id: `d${doseSeq}`,
    userId: "u1",
    medicationId: "m1",
    takenAt: new Date("2026-08-01T08:00:00Z"),
    ...overrides,
  };
  await database.insert(schema.doseLogs).values(row);
  return row;
}

/** Seed after the user. The overdue sweep INNER JOINs user_preferences,
    so a reminder test without this row returns zero rows and passes
    vacuously — the fixture exists to make that failure impossible. */
export async function seedPreferences(
  overrides: Partial<typeof schema.userPreferences.$inferInsert> = {},
) {
  const row: typeof schema.userPreferences.$inferInsert = {
    userId: "u1",
    ...overrides,
  };
  await database.insert(schema.userPreferences).values(row).onConflictDoNothing();
  return row;
}

let scheduleSeq = 0;

/** Seed after the medication it belongs to — real Postgres enforces the
    cascade foreign key that `fake-db` ignored. */
export async function seedSchedule(
  overrides: Partial<typeof schema.medicationSchedules.$inferInsert> = {},
) {
  scheduleSeq += 1;
  const row: typeof schema.medicationSchedules.$inferInsert = {
    id: `s${scheduleSeq}`,
    userId: "u1",
    medicationId: "m1",
    scheduleKind: "fixed_time",
    timeOfDay: "08:00",
    ...overrides,
  };
  await database.insert(schema.medicationSchedules).values(row);
  return row;
}

export const pgDb = {
  client,
  db: database,
  reset,
  seedUser,
  seedMedication,
  seedDose,
  seedPreferences,
  seedSchedule,
};
