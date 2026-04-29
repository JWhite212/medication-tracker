import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { startOfDay } from "$lib/utils/time";
import { getSchedulesForUser } from "$lib/server/schedules";
import type { MedicationSchedule } from "$lib/server/schedules";
import type { DoseLogStatus } from "$lib/server/db/schema";

/**
 * Sum expected doses per day across a medication's schedule rows.
 * - interval rows contribute 24 / intervalHours
 * - fixed_time rows contribute 1, scaled down if daysOfWeek restricts
 *   the schedule to specific weekdays
 * - prn rows contribute 0
 */
export function expectedPerDayForSchedules(schedules: MedicationSchedule[]): number {
  let perDay = 0;
  for (const s of schedules) {
    if (s.scheduleKind === "prn") continue;
    if (s.scheduleKind === "interval" && s.intervalHours) {
      const hrs = Number(s.intervalHours);
      if (hrs > 0) perDay += 24 / hrs;
    } else if (s.scheduleKind === "fixed_time" && s.timeOfDay) {
      const dayFraction = s.daysOfWeek && s.daysOfWeek.length > 0 ? s.daysOfWeek.length / 7 : 1;
      perDay += dayFraction;
    }
  }
  return perDay;
}

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
  status: DoseLogStatus | "any" = "taken",
) {
  const baseUser = eq(doseLogs.userId, userId);
  const statusFilter = status === "any" ? undefined : eq(doseLogs.status, status);

  if (range?.from && range?.to) {
    return and(
      baseUser,
      ...(statusFilter ? [statusFilter] : []),
      gte(doseLogs.takenAt, range.from),
      lte(doseLogs.takenAt, range.to),
    );
  }
  const since = startOfDay(new Date(Date.now() - days * 86400000), timezone);
  return and(baseUser, ...(statusFilter ? [statusFilter] : []), gte(doseLogs.takenAt, since));
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

export function calculateStreak(sortedDates: string[], timezone: string = "UTC"): number {
  if (sortedDates.length === 0) return 0;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
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

// Visual adherence: capped at 100% so the bar never overshoots.
// Use calculateOveruse() for the over-100 overflow.
export function calculateAdherence(taken: number, expected: number): number {
  if (expected === 0) return 0;
  const raw = Math.round((taken / expected) * 1000) / 10;
  return Math.min(100, raw);
}

export function calculateOveruse(taken: number, expected: number): number {
  if (expected === 0) return 0;
  if (taken <= expected) return 0;
  return Math.round(((taken - expected) / expected) * 1000) / 10;
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
    .orderBy(desc(sql`date(${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`));
}

export async function getPerMedicationStats(
  userId: string,
  days: number,
  timezone: string = "UTC",
  range?: DateRange,
  options?: { includeAsNeeded?: boolean },
) {
  const whereClauseAll = buildDateFilters(userId, days, timezone, range, "any");

  const effectiveDays =
    range?.from && range?.to
      ? Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / 86400000))
      : days;

  const [rows, schedulesByMed] = await Promise.all([
    db
      .select({
        medicationId: doseLogs.medicationId,
        medicationName: medications.name,
        colour: medications.colour,
        scheduleIntervalHours: medications.scheduleIntervalHours,
        scheduleType: medications.scheduleType,
        status: doseLogs.status,
        events: sql<number>`count(*)::int`,
        quantity: sql<number>`coalesce(sum(${doseLogs.quantity}), 0)::int`,
      })
      .from(doseLogs)
      .innerJoin(
        medications,
        and(eq(doseLogs.medicationId, medications.id), eq(medications.userId, userId)),
      )
      .where(whereClauseAll)
      .groupBy(
        doseLogs.medicationId,
        medications.name,
        medications.colour,
        medications.scheduleIntervalHours,
        medications.scheduleType,
        doseLogs.status,
      ),
    getSchedulesForUser(userId),
  ]);

  type Bucket = {
    medicationId: string;
    medicationName: string;
    colour: string;
    scheduleIntervalHours: string | null;
    scheduleType: string;
    takenEvents: number;
    takenQuantity: number;
    skippedEvents: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const row of rows) {
    const b = buckets.get(row.medicationId) ?? {
      medicationId: row.medicationId,
      medicationName: row.medicationName,
      colour: row.colour,
      scheduleIntervalHours: row.scheduleIntervalHours,
      scheduleType: row.scheduleType,
      takenEvents: 0,
      takenQuantity: 0,
      skippedEvents: 0,
    };
    if (row.status === "taken") {
      b.takenEvents += row.events;
      b.takenQuantity += row.quantity;
    } else if (row.status === "skipped") {
      b.skippedEvents += row.events;
    }
    buckets.set(row.medicationId, b);
  }

  const includeAsNeeded = options?.includeAsNeeded ?? false;

  return [...buckets.values()]
    .filter((b) => {
      if (includeAsNeeded) return true;
      const sched = schedulesByMed.get(b.medicationId);
      // Hide pure-PRN medications by default. Fall back to legacy
      // scheduleType column if no schedule rows exist yet (pre-backfill).
      if (sched && sched.length > 0) {
        return sched.some((s) => s.scheduleKind !== "prn");
      }
      return b.scheduleType !== "as_needed";
    })
    .map((b) => {
      const sched = schedulesByMed.get(b.medicationId) ?? [];
      const expectedPerDay =
        sched.length > 0
          ? expectedPerDayForSchedules(sched)
          : b.scheduleIntervalHours
            ? 24 / Number(b.scheduleIntervalHours)
            : 0;
      const expectedTotal = Math.round(expectedPerDay * effectiveDays);
      return {
        medicationId: b.medicationId,
        medicationName: b.medicationName,
        colour: b.colour,
        scheduleIntervalHours: b.scheduleIntervalHours,
        scheduleType: b.scheduleType,
        doseCount: b.takenEvents,
        takenEvents: b.takenEvents,
        takenQuantity: b.takenQuantity,
        skippedEvents: b.skippedEvents,
        expectedTotal,
        adherence: calculateAdherence(b.takenEvents, expectedTotal),
        overuse: calculateOveruse(b.takenEvents, expectedTotal),
      };
    });
}

// User-level dose status breakdown. Per the doc, missedCount is
// "expected but unresolved" — for interval schedules we infer it as
// expected - taken - skipped (clamped at 0). For as_needed meds we
// treat expected as 0.
export async function getDoseStatusBreakdown(
  userId: string,
  days: number,
  timezone: string = "UTC",
  range?: DateRange,
) {
  const stats = await getPerMedicationStats(userId, days, timezone, range, {
    includeAsNeeded: true,
  });

  let takenEvents = 0;
  let takenQuantity = 0;
  let skippedEvents = 0;
  let expectedTotal = 0;

  for (const m of stats) {
    takenEvents += m.takenEvents;
    takenQuantity += m.takenQuantity;
    skippedEvents += m.skippedEvents;
    expectedTotal += m.expectedTotal;
  }

  const resolved = takenEvents + skippedEvents;
  const missedEvents = Math.max(0, expectedTotal - resolved);

  return {
    takenEvents,
    takenQuantity,
    skippedEvents,
    missedEvents,
    expectedTotal,
    adherencePercent: calculateAdherence(takenEvents, expectedTotal),
    overusePercent: calculateOveruse(takenEvents, expectedTotal),
  };
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
    .groupBy(sql`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`)
    .orderBy(sql`extract(hour from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`);
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
    .groupBy(sql`extract(dow from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`)
    .orderBy(sql`extract(dow from ${doseLogs.takenAt} AT TIME ZONE ${safeTz(timezone)})`);
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

  const effectCounts = new Map<string, { count: number; severities: Map<string, number> }>();
  const medEffects = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!row.sideEffects) continue;
    for (const effect of row.sideEffects) {
      const existing = effectCounts.get(effect.name) ?? {
        count: 0,
        severities: new Map(),
      };
      existing.count++;
      existing.severities.set(effect.severity, (existing.severities.get(effect.severity) ?? 0) + 1);
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
