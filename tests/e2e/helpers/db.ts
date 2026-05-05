// Thin DB helpers for E2E assertions that need a server-side ground
// truth (e.g. "did inventory actually decrement"). All reads are
// scoped by userId.

if (process.env.E2E_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
}

import { eq, and } from "drizzle-orm";
import { db } from "../../../src/lib/server/db";
import { users, medications, doseLogs } from "../../../src/lib/server/db/schema";

export async function getUserIdByEmail(email: string): Promise<string | null> {
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
