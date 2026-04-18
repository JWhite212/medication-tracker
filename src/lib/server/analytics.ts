import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { startOfDay } from "$lib/utils/time";

const validTimezones = new Set(Intl.supportedValuesOf("timeZone"));

function safeTz(timezone: string): ReturnType<typeof sql.raw> {
  const tz = validTimezones.has(timezone) ? timezone : "UTC";
  return sql.raw(`'${tz}'`);
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

function buildDateFilters(
  userId: string,
  days: number,
  timezone: string,
  range?: DateRange,
) {
  if (range?.from && range?.to) {
    return and(
      eq(doseLogs.userId, userId),
      gte(doseLogs.takenAt, range.from),
      lte(doseLogs.takenAt, range.to),
    );
  }
  const since = startOfDay(new Date(Date.now() - days * 86400000), timezone);
  return and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, since));
}

export function calculateTrend(
  current: number,
  previous: number,
): { direction: "up" | "down" | "flat"; percent: number } {
  if (previous === 0 && current === 0) return { direction: "flat", percent: 0 };
  if (previous === 0) return { direction: "up", percent: 100 };
  const change = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(change));
  if (rounded === 0) return { direction: "flat", percent: 0 };
  return { direction: change > 0 ? "up" : "down", percent: rounded };
}

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
  range?: DateRange,
) {
  return db
    .select({
      date: sql<string>`date(${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`,
      count: sql<number>`count(*)::int`,
    })
    .from(doseLogs)
    .where(buildDateFilters(userId, days, timezone, range))
    .groupBy(sql`date(${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`)
    .orderBy(
      desc(sql`date(${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`),
    );
}

export async function getPerMedicationStats(
  userId: string,
  days: number,
  timezone: string = "UTC",
  range?: DateRange,
) {
  const whereClause = buildDateFilters(userId, days, timezone, range);

  const effectiveDays =
    range?.from && range?.to
      ? Math.max(
          1,
          Math.round((range.to.getTime() - range.from.getTime()) / 86400000),
        )
      : days;

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
    .where(whereClause)
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
      const expectedTotal = Math.round(expectedPerDay * effectiveDays);
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
  range?: DateRange,
) {
  return db
    .select({
      hour: sql<number>`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(doseLogs)
    .where(buildDateFilters(userId, days, timezone, range))
    .groupBy(
      sql`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`,
    )
    .orderBy(
      sql`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`,
    );
}

export async function getDayOfWeekDistribution(
  userId: string,
  days: number,
  timezone: string = "UTC",
  range?: DateRange,
) {
  return db
    .select({
      dayOfWeek: sql<number>`extract(dow from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(doseLogs)
    .where(buildDateFilters(userId, days, timezone, range))
    .groupBy(
      sql`extract(dow from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`,
    )
    .orderBy(
      sql`extract(dow from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`,
    );
}

export async function getSideEffectStats(
  userId: string,
  days: number,
  timezone: string = "UTC",
  range?: DateRange,
) {
  const rows = await db
    .select({
      sideEffects: doseLogs.sideEffects,
      medicationName: medications.name,
    })
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(buildDateFilters(userId, days, timezone, range));

  const effectCounts = new Map<
    string,
    { count: number; severities: Map<string, number> }
  >();
  const medEffects = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!row.sideEffects) continue;
    for (const effect of row.sideEffects) {
      const existing = effectCounts.get(effect.name) ?? {
        count: 0,
        severities: new Map(),
      };
      existing.count++;
      existing.severities.set(
        effect.severity,
        (existing.severities.get(effect.severity) ?? 0) + 1,
      );
      effectCounts.set(effect.name, existing);

      const medMap = medEffects.get(row.medicationName) ?? new Map();
      medMap.set(effect.name, (medMap.get(effect.name) ?? 0) + 1);
      medEffects.set(row.medicationName, medMap);
    }
  }

  return {
    frequency: [...effectCounts.entries()]
      .map(([name, { count, severities }]) => ({
        name,
        count,
        severities: Object.fromEntries(severities),
      }))
      .sort((a, b) => b.count - a.count),
    byMedication: [...medEffects.entries()].map(([medication, effects]) => ({
      medication,
      effects: [...effects.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    })),
  };
}
