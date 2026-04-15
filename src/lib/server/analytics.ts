import { eq, and, gte, sql, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";

export function calculateStreak(
  sortedDates: string[],
  timezone: string = "UTC",
): number {
  if (sortedDates.length === 0) return 0;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
    new Date(),
  );
  if (sortedDates[0] !== today) return 0;
  let streak = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]);
    const curr = new Date(sortedDates[i]);
    const diffDays = (prev.getTime() - curr.getTime()) / 86400000;
    if (Math.round(diffDays) === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function calculateAdherence(taken: number, expected: number): number {
  if (expected === 0) return 0;
  return Math.round((taken / expected) * 1000) / 10;
}

export async function getDailyDoseCounts(
  userId: string,
  days: number,
  timezone: string = "UTC",
) {
  const since = new Date(Date.now() - days * 86400000);
  return db
    .select({
      date: sql<string>`date(${doseLogs.takenAt} AT TIME ZONE ${timezone})`,
      count: sql<number>`count(*)::int`,
    })
    .from(doseLogs)
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, since)))
    .groupBy(sql`date(${doseLogs.takenAt} AT TIME ZONE ${timezone})`)
    .orderBy(desc(sql`date(${doseLogs.takenAt} AT TIME ZONE ${timezone})`));
}

export async function getPerMedicationStats(userId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const rows = await db
    .select({
      medicationId: doseLogs.medicationId,
      medicationName: medications.name,
      colour: medications.colour,
      scheduleIntervalHours: medications.scheduleIntervalHours,
      scheduleType: medications.scheduleType,
      doseCount: sql<number>`count(*)::int`,
    })
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, since)))
    .groupBy(
      doseLogs.medicationId,
      medications.name,
      medications.colour,
      medications.scheduleIntervalHours,
      medications.scheduleType,
    );

  return rows
    .filter((row) => row.scheduleType !== "as_needed")
    .map((row) => {
      const expectedPerDay = row.scheduleIntervalHours
        ? 24 / Number(row.scheduleIntervalHours)
        : 1;
      const expectedTotal = Math.round(expectedPerDay * days);
      return {
        ...row,
        adherence: calculateAdherence(row.doseCount, expectedTotal),
        expectedTotal,
      };
    });
}

export async function getHourlyDistribution(
  userId: string,
  days: number,
  timezone: string = "UTC",
) {
  const since = new Date(Date.now() - days * 86400000);
  return db
    .select({
      hour: sql<number>`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${timezone})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(doseLogs)
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, since)))
    .groupBy(
      sql`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${timezone})`,
    )
    .orderBy(
      sql`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${timezone})`,
    );
}
