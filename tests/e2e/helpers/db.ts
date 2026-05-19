// Thin DB helpers for E2E assertions that need a server-side ground
// truth (e.g. "did inventory actually decrement"). All reads are
// scoped by userId.

import { eq, and, asc } from "drizzle-orm";
import {
  users,
  medications,
  doseLogs,
  medicationSchedules,
} from "../../../src/lib/server/db/schema";

// ESM hoists `import` statements above any top-level statements, so
// the env-var assignment must live inside a runtime initializer to
// take effect before the Neon driver is instantiated. Cache the
// module so we only pay the dynamic-import cost once.
let dbPromise: Promise<typeof import("../../../src/lib/server/db").db> | null = null;
async function getDb() {
  if (!dbPromise) {
    if (process.env.E2E_DATABASE_URL && !process.env.DATABASE_URL) {
      process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    }
    dbPromise = import("../../../src/lib/server/db").then((m) => m.db);
  }
  return dbPromise;
}

export async function getUserIdByEmail(email: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row?.id ?? null;
}

export async function getInventoryCount(
  userId: string,
  medicationName: string,
): Promise<number | null> {
  const db = await getDb();
  const [row] = await db
    .select({ inventoryCount: medications.inventoryCount })
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.name, medicationName)))
    .limit(1);
  return row?.inventoryCount ?? null;
}

export async function countDoseLogs(
  userId: string,
  medicationName: string,
  status?: "taken" | "skipped" | "missed",
): Promise<number> {
  const db = await getDb();
  const [med] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.name, medicationName)))
    .limit(1);
  if (!med) return 0;

  const conditions = status
    ? and(eq(doseLogs.medicationId, med.id), eq(doseLogs.status, status))
    : eq(doseLogs.medicationId, med.id);
  const rows = await db.select({ id: doseLogs.id }).from(doseLogs).where(conditions);
  return rows.length;
}

export async function getMedicationIdByName(
  userId: string,
  medicationName: string,
): Promise<string | null> {
  const db = await getDb();
  const [row] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.name, medicationName)))
    .limit(1);
  return row?.id ?? null;
}

export type ScheduleRow = {
  scheduleKind: "fixed_time" | "interval" | "prn";
  timeOfDay: string | null;
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  sortOrder: number;
};

export async function getSchedulesForMedication(medicationId: string): Promise<ScheduleRow[]> {
  const db = await getDb();
  const rows = await db
    .select({
      scheduleKind: medicationSchedules.scheduleKind,
      timeOfDay: medicationSchedules.timeOfDay,
      intervalHours: medicationSchedules.intervalHours,
      daysOfWeek: medicationSchedules.daysOfWeek,
      sortOrder: medicationSchedules.sortOrder,
    })
    .from(medicationSchedules)
    .where(eq(medicationSchedules.medicationId, medicationId))
    .orderBy(asc(medicationSchedules.sortOrder));
  return rows as ScheduleRow[];
}

// FK constraints cascade from medications → medication_schedules and
// dose_logs, so deleting the medication is enough cleanup for these
// tests (no dose logs are created against the temp meds).
export async function deleteMedicationCascade(medicationId: string): Promise<void> {
  const db = await getDb();
  await db.delete(medications).where(eq(medications.id, medicationId));
}
