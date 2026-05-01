// Pure helpers for clamping a medication's (or schedule's) lifecycle
// window against an arbitrary analytics date range. No DB access, no
// timezone math beyond UTC millisecond arithmetic — callers pass in
// Date objects representing the relevant instants.

const MS_PER_DAY = 86_400_000;

/**
 * Number of days in the intersection of `[rangeFrom, rangeTo]` and
 * `[startedAt, endedAt ?? +Infinity]`. Returns 0 when the lifecycle
 * window does not overlap the range at all (e.g. a med added today
 * being asked about last week's adherence).
 *
 * The result is rounded — partial days at either edge contribute as
 * fractional days that are then rounded to the nearest whole day,
 * matching the existing `effectiveDays` rounding in `analytics.ts`.
 */
export function clampEffectiveDays(
  rangeFrom: Date,
  rangeTo: Date,
  startedAt: Date,
  endedAt: Date | null,
): number {
  const fromMs = rangeFrom.getTime();
  const toMs = rangeTo.getTime();
  const startMs = startedAt.getTime();
  const endMs = endedAt ? endedAt.getTime() : Number.POSITIVE_INFINITY;

  const effFrom = Math.max(fromMs, startMs);
  const effTo = Math.min(toMs, endMs);

  if (effTo <= effFrom) return 0;
  return Math.max(0, Math.round((effTo - effFrom) / MS_PER_DAY));
}

/**
 * Is `date` inside `[startedAt, endedAt]`? `endedAt` null means open
 * on the right (med still active). Used by daily adherence to decide
 * whether a med contributes expected doses on a given day.
 */
export function isActiveOn(date: Date, startedAt: Date, endedAt: Date | null): boolean {
  const t = date.getTime();
  if (t < startedAt.getTime()) return false;
  if (endedAt && t > endedAt.getTime()) return false;
  return true;
}
