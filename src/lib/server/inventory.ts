import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications, doseLogs } from "$lib/server/db/schema";
import { getSchedulesForUser } from "$lib/server/schedules";
import { expectedPerDayForSchedules } from "$lib/server/analytics";
import type { MedicationSchedule } from "$lib/server/schedules";
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
import { atOrBelowAlertThreshold } from "$lib/utils/low-stock";
import { refillStatus, toneOf } from "$lib/utils/status-tone";
// Types live in $lib/types so client components (RefillsCard) can
// import without crossing the $lib/server boundary. Re-exported here
// for backward-compatible callers.
export type { RefillSeverity, RefillForecastEntry } from "$lib/types";
import type { RefillSeverity, RefillForecastEntry } from "$lib/types";

export const REFILL_THRESHOLDS = {
  critical: 3,
  warning: 7,
  watch: 14,
} as const;

export function classifyRefillSeverity(daysUntilRefill: number | null): RefillSeverity {
  if (daysUntilRefill === null) return "ok";
  if (daysUntilRefill <= REFILL_THRESHOLDS.critical) return "critical";
  if (daysUntilRefill <= REFILL_THRESHOLDS.warning) return "warning";
  if (daysUntilRefill <= REFILL_THRESHOLDS.watch) return "watch";
  return "ok";
}

// Daily consumption rate. Prefers the schedule rate (24/intervalHours
// or sum across multiple fixed-time/interval schedule rows) for any
// medication with at least one scheduled (non-PRN) row. PRN-only meds
// fall back to a 30-day historical average. Returns 0 when no signal
// is available.
export function dailyRateFor(
  schedules: MedicationSchedule[] | undefined,
  legacyScheduleType: string,
  legacyIntervalHours: number | string | null,
  thirtyDayDoseCount: number,
): number {
  if (schedules && schedules.length > 0) {
    const scheduledRate = expectedPerDayForSchedules(schedules);
    if (scheduledRate > 0) return scheduledRate;
    // Schedule rows exist but contribute nothing (e.g. all-PRN). Try
    // the legacy column as a safety net before falling to history —
    // covers partially-migrated meds where the legacy column is
    // accurate even if schedule_table rows aren't.
  }
  if (legacyScheduleType === "scheduled") {
    const legacyRate = intervalDosesPerDay(legacyIntervalHours);
    if (legacyRate > 0) return legacyRate;
  }
  return thirtyDayDoseCount / 30;
}

export function daysUntilRefill(inventoryCount: number | null, dailyRate: number): number | null {
  if (inventoryCount === null) return null;
  if (dailyRate <= 0) return null;
  return Math.floor(inventoryCount / dailyRate);
}

export async function getRefillForecast(userId: string): Promise<RefillForecastEntry[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [meds, schedulesByMed, doseCounts] = await Promise.all([
    db
      .select({
        id: medications.id,
        name: medications.name,
        colour: medications.colour,
        inventoryCount: medications.inventoryCount,
        inventoryAlertThreshold: medications.inventoryAlertThreshold,
        scheduleType: medications.scheduleType,
        scheduleIntervalHours: medications.scheduleIntervalHours,
      })
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, false))),
    getSchedulesForUser(userId),
    db
      .select({
        medicationId: doseLogs.medicationId,
        // Sum doses, not log rows — quantity can be > 1 and inventoryCount
        // is measured in doses (see CLAUDE.md gotcha).
        count: sql<number>`coalesce(sum(${doseLogs.quantity}), 0)::int`,
      })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.status, "taken"),
          gte(doseLogs.takenAt, thirtyDaysAgo),
        ),
      )
      .groupBy(doseLogs.medicationId),
  ]);

  const countsByMed = new Map<string, number>(
    doseCounts.map((d) => [d.medicationId, Number(d.count)]),
  );

  const out: RefillForecastEntry[] = [];
  for (const med of meds) {
    if (med.inventoryCount === null) continue;
    const schedules = schedulesByMed.get(med.id);
    const dailyRate = dailyRateFor(
      schedules,
      med.scheduleType,
      med.scheduleIntervalHours,
      countsByMed.get(med.id) ?? 0,
    );
    const days = daysUntilRefill(med.inventoryCount, dailyRate);
    const severity = classifyRefillSeverity(days);
    // Listed exactly when RefillsCard's `refillChip` draws a chip for it: a
    // tier that needs watching, or stock at the user's own alert level
    // whatever the tier, which is the medications card's amber chip and the
    // low-stock alert's trigger.
    const low = atOrBelowAlertThreshold(med.inventoryCount, med.inventoryAlertThreshold);
    if (severity === "ok" && !low) continue;
    out.push({
      medicationId: med.id,
      medicationName: med.name,
      colour: med.colour,
      inventoryCount: med.inventoryCount,
      inventoryAlertThreshold: med.inventoryAlertThreshold,
      dailyRate,
      daysUntilRefill: days,
      severity,
    });
  }

  // Amber rows first, then fewest days left. A row at its alert level asks
  // for a reorder, so it sorts with critical and warning rather than under a
  // neutral watch row, and its days put it after them: an ok forecast is
  // over 14 days or none at all.
  const needsYou = (e: RefillForecastEntry) =>
    atOrBelowAlertThreshold(e.inventoryCount, e.inventoryAlertThreshold) ||
    toneOf(refillStatus(e.severity)) === "needs-you";
  out.sort(
    (a, b) =>
      Number(needsYou(b)) - Number(needsYou(a)) ||
      (a.daysUntilRefill ?? Infinity) - (b.daysUntilRefill ?? Infinity),
  );
  return out;
}
