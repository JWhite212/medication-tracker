// Pure helpers for clamping a medication's (or schedule's) lifecycle
// window against an arbitrary analytics date range. No DB access, no
// timezone math beyond UTC millisecond arithmetic — callers pass in
// Date objects representing the relevant instants.

const MS_PER_DAY = 86_400_000;

/**
 * How far short of `n * 24h` a range of `n` whole days may fall.
 *
 * The PDF export is the one caller whose bounds are LOCAL midnights —
 * `api/export/+server.ts` builds them with `parseDayRangeParam(..., tz, ...)`
 * — and a civil day is 23, 24, 24.5 or 25 hours. A range containing a
 * spring-forward is therefore exactly one transition short of `n * 24h`, and
 * without this slack a London user's 1–31 March report scored 30 days: the
 * clinician PDF printed "Expected events: 30" over 31 days of doses and
 * added an "Overuse: 3.3%" line to a patient with perfect adherence. A
 * single-day report on the transition day itself read "Adherence: 0%".
 *
 * **Two hours, because that is the largest transition in the IANA database**
 * — Antarctica/Troll moves UTC+0 to UTC+2. Everywhere else is an hour, or
 * thirty minutes on Lord Howe. Chatham's +12:45 is an OFFSET, not a
 * transition size, and is irrelevant here. `tests/unit/analytics-lifecycle.test.ts`
 * asserts the 2h bound against every zone the runtime knows, so a tzdata
 * release that widened it would fail rather than silently lose a day.
 *
 * A range can never be short by more than ONE transition: any further
 * spring-forward it spans is preceded by a fall-back that cancels it.
 *
 * The trailing millisecond is `lastIncludedInstant`'s — `export-pdf.ts` hands
 * the breakdown `to - 1ms` so its summary counts exactly the rows the dose
 * table beneath it lists. Tolerating exactly one millisecond is the same
 * statement as subtracting exactly one.
 *
 * **The cost, stated plainly:** a partial overlap of 22 hours or more is
 * charged as a whole day. That is a re-widening of the defect this slack sits
 * inside — but to 22h from the 12h that `Math.round` allowed, and only for a
 * lifecycle edge, where `Math.round` did it to every window every day.
 */
const RANGE_SHORTFALL_TOLERANCE_MS = 2 * 60 * 60 * 1000 + 1;

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
 * A span is counted as `n` days once it comes within
 * `RANGE_SHORTFALL_TOLERANCE_MS` of `n * 24h` — see that constant for why the
 * slack is two hours and one millisecond rather than the millisecond alone.
 *
 * NB this measures a duration in UTC milliseconds, so it counts 24-hour days
 * and only *tolerates* civil ones. `getDailyAdherenceSeries` genuinely counts
 * day keys via `isActiveOn`, so the two still part company on a lifecycle edge
 * falling mid-day. Converging them needs a shared civil-day counter and a
 * timezone in this module, and that in turn needs the two doors to agree
 * first on whether `rangeTo` is inclusive or exclusive — the PDF passes the
 * last included instant, the analytics page a UTC midnight, and in day-key
 * space that one-millisecond distinction disappears. Deliberately not this
 * change.
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
  return Math.floor((effTo - effFrom + RANGE_SHORTFALL_TOLERANCE_MS) / MS_PER_DAY);
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
