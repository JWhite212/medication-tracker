/**
 * The single usability test for a schedule interval, and the dose rate it
 * implies.
 *
 * Drizzle `numeric` columns arrive in JS as **strings**, so the obvious guard
 * `if (!intervalHours)` does not reject a zero interval — `"0"` is truthy.
 * That is not hypothetical: it is the defect this module was extracted to fix.
 * `computeOverdueSlot` passed a `"0"` row, computed an interval of 0ms, and
 * returned the dose the user had just logged as an overdue slot.
 *
 * Lives in `utils/` and not `server/` because `utils/time.ts` and
 * `utils/schedule.ts` are client-reachable and may never import `$lib/server`.
 */

/**
 * Admission bound for NEW interval input, in hours.
 *
 * A door policy, applied where data enters: the two Zod schemas and the import
 * gate. Deliberately NOT applied when reading stored rows — a stored 168 (a
 * weekly injection) is a meaningful rate that predates the bound, and
 * rejecting it on read would silently drop that medication out of refill
 * forecasting, out of the adherence denominator and out of reminders.
 */
export const MAX_INTERVAL_HOURS = 72;

/**
 * Parse a stored interval into usable hours, or null if it cannot produce a
 * rate. Accepts the string form Drizzle returns as well as a plain number.
 *
 * Returns the hours rather than a boolean so callers replace BOTH halves of
 * the old two-step (guard, then `Number(...)`) with one call — which is what
 * removes the opportunity to spell the guard a seventh way.
 *
 * The `Number.isFinite` requirement slightly TIGHTENS computeScheduleSlots
 * and that is deliberate: a non-finite stored interval used to be truthy,
 * pass the old guard, and yield one phantom slot at the anchor. It now
 * yields none. Unreachable through any write door; pinned by a test in
 * tests/unit/schedule.test.ts.
 */
export function parseIntervalHours(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return hours;
}

/** Doses per day implied by an interval row: `24 / hours`, or 0 if unusable. */
export function intervalDosesPerDay(raw: string | number | null | undefined): number {
  const hours = parseIntervalHours(raw);
  return hours === null ? 0 : 24 / hours;
}
