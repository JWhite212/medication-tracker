import { parseIntervalHours } from "$lib/utils/schedule-rate";

/**
 * Weekly adherence math for the Medications list cards.
 *
 * `expectedDailyDoses` is the schedule-aware rate computed server-side
 * (medication_schedules first). The legacy interval column is only a
 * fallback — it is null for fixed-time schedules, which is exactly the
 * bug that made a twice-daily med look once-daily and report 100%
 * adherence at 50%.
 *
 * Shares parseIntervalHours's usability guard, but NOT
 * intervalDosesPerDay's 0 fallback: with no rate available at all, this
 * card assumes once-daily rather than zero-expected, so it keeps its
 * own 1-per-day default. Do not swap that fallback for the primitive's.
 */
export function expectedWeeklyDoses(
  expectedDailyDoses: number | null | undefined,
  legacyIntervalHours: number | string | null | undefined,
): number {
  if (expectedDailyDoses != null && expectedDailyDoses > 0) {
    return Math.round(7 * expectedDailyDoses);
  }
  const hours = parseIntervalHours(legacyIntervalHours);
  const daily = hours !== null ? 24 / hours : 1;
  return Math.round(7 * daily);
}

export function adherencePercent(takenWeekly: number, expectedWeekly: number): number {
  if (expectedWeekly <= 0) return 0;
  return Math.min(100, Math.round((takenWeekly / expectedWeekly) * 100));
}
