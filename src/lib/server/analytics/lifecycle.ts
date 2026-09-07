// Pure helpers for clamping a medication's (or schedule's) lifecycle
// window against an arbitrary analytics date range. No DB access, no
// timezone math beyond UTC millisecond arithmetic — callers pass in
// Date objects representing the relevant instants.

const MS_PER_DAY = 86_400_000;

/**
 * Number of WHOLE days in the intersection of `[rangeFrom, rangeTo]` and
 * `[startedAt, endedAt ?? +Infinity]`. Returns 0 when the lifecycle
 * window does not overlap the range at all (e.g. a med added today
 * being asked about last week's adherence).
 *
 * **A partial day is not charged.** The result used to be `Math.round`ed,
 * which charged a whole expected dose from the moment the partial day
 * reached twelve hours — so a patient who had taken every dose since
 * starting a medication fifteen and a half days ago was shown 16 expected,
 * one missed, and 93.8% adherence, and the number moved at local noon with
 * no user action. Rounding up cannot be right here: the extra dose renders
 * as a red "Missed" segment, as a clinician-facing missed count and as a
 * "Lowest adherence" insight, so fabricating one is the costlier error.
 * `Math.ceil` is the same mistake made sooner — a medication added six
 * hours ago would acquire a full day of expectation.
 *
 * The range is treated as **closed at `rangeTo`**, which is what the `+ 1`
 * buys: `export-pdf.ts` hands the breakdown `to - 1ms` so its summary counts
 * exactly the rows the dose table beneath it lists, and a plain truncation
 * would score that 30-day report as 29 days. Tolerating exactly one
 * millisecond is the same statement as subtracting exactly one.
 *
 * NB this measures a duration in UTC milliseconds, so it counts 24-hour
 * days rather than civil days. `getDailyAdherenceSeries` counts day keys via
 * `isActiveOn` instead, and the two still part company on a lifecycle edge
 * falling mid-day. Converging them needs a shared civil-day counter and a
 * timezone in this module; it is deliberately not this change.
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
  return Math.floor((effTo - effFrom + 1) / MS_PER_DAY);
}

/**
 * The instant a medication stopped being expected.
 *
 * Two columns can close the window and they are written by different
 * things: `endedAt` only ever arrives through import or the API — no UI
 * writes it — while archiving is the one "I stopped taking this" signal
 * the app itself produces, and it sets `archivedAt` and nothing else.
 * Consulting either alone gets a real user wrong, so the effective end is
 * whichever comes first. Null means still running.
 *
 * Callers pass the result to `clampEffectiveDays` / `isActiveOn`, which is
 * why this is a separate function rather than another parameter on them:
 * those two own clamping against a window, this owns deciding where the
 * window closes.
 */
export function lifecycleEnd(life: { endedAt: Date | null; archivedAt: Date | null }): Date | null {
  const { endedAt, archivedAt } = life;
  if (endedAt && archivedAt) return endedAt.getTime() < archivedAt.getTime() ? endedAt : archivedAt;
  return endedAt ?? archivedAt;
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
