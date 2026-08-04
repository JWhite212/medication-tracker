/**
 * Weekly adherence math for the Medications list cards.
 *
 * `expectedDailyDoses` is the schedule-aware rate computed server-side
 * (medication_schedules first). The legacy interval column is only a
 * fallback — it is null for fixed-time schedules, which is exactly the
 * bug that made a twice-daily med look once-daily and report 100%
 * adherence at 50%.
 */
export function expectedWeeklyDoses(
  expectedDailyDoses: number | null | undefined,
  legacyIntervalHours: number | string | null | undefined,
): number {
  if (expectedDailyDoses != null && expectedDailyDoses > 0) {
    return Math.round(7 * expectedDailyDoses);
  }
  const hrs =
    legacyIntervalHours != null && legacyIntervalHours !== "" ? Number(legacyIntervalHours) : NaN;
  const daily = Number.isFinite(hrs) && hrs > 0 ? 24 / hrs : 1;
  return Math.round(7 * daily);
}

export function adherencePercent(takenWeekly: number, expectedWeekly: number): number {
  if (expectedWeekly <= 0) return 0;
  return Math.min(100, Math.round((takenWeekly / expectedWeekly) * 100));
}
