export function formatTimeSince(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return `${diffDays}d ago`;
}

export type TimeFormat = "12h" | "24h";

/**
 * Render a date in the user's timezone and preferred clock format. This
 * is the canonical formatter — pass it the user's `preferences.timeFormat`
 * everywhere a time string is shown (dashboard, timeline, history,
 * analytics, exports, email).
 */
export function formatUserTime(
  date: Date,
  timezone: string,
  timeFormat: TimeFormat = "12h",
): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
    timeZone: timezone,
  }).format(date);
}

/**
 * @deprecated Use formatUserTime() and pass the user's timeFormat
 * preference. Kept as a thin wrapper to avoid breaking call sites that
 * haven't been threaded with the preference yet.
 */
export function formatTime(date: Date, timezone: string): string {
  return formatUserTime(date, timezone, "12h");
}

export type DateFormat = "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD";

/**
 * For the two named-month formats the preference selects a locale, not a
 * literal pattern string.
 *
 * Both enum values name a field *order*, and each order already has a locale
 * that renders it — including the abbreviated month names the app shows
 * today. Formatting through the locale is what lets the default
 * (`DD/MM/YYYY` → en-GB) reproduce the previous hardcoded output at every
 * call site byte-for-byte, so nobody who never opened Appearance sees their
 * dates change.
 *
 * `YYYY-MM-DD` is deliberately absent: a locale cannot be trusted to render
 * it. See `isoDate` below.
 */
const DATE_FORMAT_LOCALES: Record<Exclude<DateFormat, "YYYY-MM-DD">, string> = {
  "DD/MM/YYYY": "en-GB",
  "MM/DD/YYYY": "en-US",
};

/**
 * Assemble `YYYY-MM-DD` from parts rather than asking a locale for it.
 *
 * `Intl.DateTimeFormat("en-CA", { year, month: "2-digit", day: "2-digit" })`
 * happens to emit `2026-04-15` on current ICU, and the obvious implementation
 * leans on that. ECMA-402 does not promise it: field order and separator come
 * from CLDR locale data, which is explicitly allowed to change, and en-CA's
 * short-date pattern **did** change in ICU 72 — an implementation is free to
 * return `15/04/2026` and still be conformant.
 *
 * That matters more here than the usual "don't parse localised output"
 * warning, because `formatUserDate` is reached from `.svelte` components: it
 * runs against the *viewer's browser* ICU, not the pinned server one. A unit
 * test could not catch the divergence either, since vitest shares this
 * runtime. So the digits are read out of `formatToParts` — which is specified
 * per-field and therefore stable — and joined here.
 *
 * Widths are re-padded so the result is a fixed shape whatever an
 * implementation does with a year below 1000 — `year: "numeric"` renders
 * "999", not "0999".
 *
 * Exported because date **keys** need exactly this and for the same reason:
 * `export-csv.ts` writes a column `import/csv.ts` re-reads as strict
 * `YYYY-MM-DD`, so a locale that reordered the fields would produce a file
 * the exporting account could not import back.
 */
export function isoDayKeyFormatter(timezone: string): (date: Date) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return (date: Date) => {
    const parts = fmt.formatToParts(date);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";

    return [
      get("year").padStart(4, "0"),
      get("month").padStart(2, "0"),
      get("day").padStart(2, "0"),
    ].join("-");
  };
}

/** One-off form of {@link isoDayKeyFormatter}. Prefer the factory in a loop. */
export function isoDayKey(date: Date, timezone: string): string {
  return isoDayKeyFormatter(timezone)(date);
}

/**
 * Build a UTC instant from calendar fields, safe for years below 100 and for
 * out-of-range fields.
 *
 * `Date.UTC(50, 0, 1)` is 1950, not year 50 — the two-digit-year mapping is
 * specified behaviour, not a quirk to route around at the call site. So the
 * year has to be set rather than passed.
 *
 * It has to be set FIRST, though, and with the month and day in the same
 * call. An earlier version built the instant on a year-2000 pivot and then
 * called `setUTCFullYear(year)` alone, which loses a whole year whenever a
 * field overflows past 31 December: the rollover incremented the *pivot*
 * (2000 → 2001) and the year was then overwritten, so `2026-12-32` came back
 * as 2026-01-01 rather than 2027-01-01. The pivot being a leap year cost a
 * day as well — `2026-02-31` resolved to 2 March instead of 3. Both doors
 * that reach here are shape checks rather than calendar checks by design
 * (`DATETIME_LOCAL_RE`, `DAY_KEY_RE`), so overflowing fields are reachable
 * input, and a dose could be stored a year in the past with no error.
 *
 * `setUTCFullYear(year, month, day)` normalises the overflow against the
 * requested year, which is what `Date.UTC` would have done if it could be
 * trusted with the year at all.
 */
function utcFromFields(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(hour, minute, second, 0);
  return d.getTime();
}

/**
 * The zone's UTC offset, in milliseconds, at a given instant.
 *
 * Seconds are read as well as hours and minutes because historical offsets
 * are not whole minutes: Europe/London's LMT is −75 seconds, and dropping
 * the field would make a pre-1847 round-trip fail by over a minute.
 */
function zoneOffsetMsAt(instantMs: number, fmt: Intl.DateTimeFormat): number {
  const parts = fmt.formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return (
    utcFromFields(
      get("year"),
      get("month"),
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    ) - instantMs
  );
}

const MS_PER_DAY = 86_400_000;

/**
 * THE one owner of wall-clock → instant conversion. Resolve "HH:mm on the
 * local date `dayKey`, in `timezone`" to the UTC instant it names.
 *
 * Three call sites used to answer this question independently — the
 * fixed-time schedule projection, the datetime-local parser that writes
 * `dose_logs.takenAt`, and `startOfDay` — and all three were wrong. The
 * first two shared one algorithm: sample the zone's offset at the wall
 * clock *read as if it were UTC*, then subtract it. That sample is taken
 * |offset| hours away from the answer, so whenever a transition falls in
 * that gap the wrong offset is applied and the result is an hour out.
 * `startOfDay` had a different bug and a worse one — see below.
 *
 * ## The algorithm: propose, then verify
 *
 * Probe the zone a day either side of the requested wall clock, and accept
 * a candidate only if re-reading the offset AT that candidate returns the
 * offset used to compute it. That round-trip is what makes the result
 * *verified* rather than assumed, and it is why enumerating two candidates
 * terminates where iterating to a fixed point does not.
 *
 * Iteration is not an option, and this is measured rather than feared: for
 * a wall clock inside a spring-forward gap, re-sampling oscillates with
 * period 2 forever (America/New_York 2026-03-08 02:30 → 03:30 → 01:30 →
 * 03:30 → …). A `while (changed)` loop hangs; a fixed-count loop returns an
 * answer that depends on whether someone wrote two passes or three, and
 * those two straddle the gap by an hour.
 *
 * Probing ±24h rather than ±1h is deliberate: DST shifts are not all whole
 * hours (Australia/Lord_Howe moves 30 minutes, Pacific/Chatham sits at
 * +12:45), and zones have historically moved by far more.
 *
 * ## The two policies, chosen rather than emergent
 *
 * **Gap** — a wall clock that never happens. Resolve FORWARD, by the width
 * of the gap. Never throw and never return null: a dose logged at 02:30 on
 * a spring-forward day is a real dose, and the two callers that would have
 * to handle a null are the reminder sweep and the dashboard's day window,
 * where "no answer" means a silently skipped dose.
 *
 * **Overlap** — a wall clock that happens twice. Take the EARLIER instant,
 * by name. It falls out of trying `offsetBefore` first, and it is asserted
 * in tests so it cannot drift back to being emergent. The shipped code was
 * *arbitrary* here: it picked the earlier instant in New York and the later
 * one in London. Stability matters beyond tidiness — `buildOverdueDedupeKey`
 * embeds the resolved slot's ISO string, so a wobbling choice would mint a
 * fresh dedupe key and re-send a reminder the user already had.
 *
 * ## The invariant callers must respect
 *
 * **A returned instant does not carry a civil day.** Do not infer one from
 * it — ask `isoDayKey` if you need one, or better, keep using the day key
 * you already had.
 *
 * An earlier draft of this work justified forward resolution with "it never
 * leaves the requested civil day". That guarantee is false, and not merely
 * unmet — it is unsatisfiable. America/Godthab springs forward at 23:00
 * local, so on 2026-03-28 all 60 minutes of the 23:00 band do not exist and
 * a 23:30 dose *necessarily* rolls to 2026-03-29. That is pinned by name in
 * tests/unit/dst-wall-clock.test.ts; do not restate the false version here
 * or in CLAUDE.md.
 *
 * This is exactly why `expectedTimesForFixedTime` and `computeOverdueSlot`
 * take their day-of-week from the requested day key and never from the
 * instant this returns: a Saturday-only medication whose slot rolls into
 * Sunday would otherwise vanish from both the timeline and the sweep.
 *
 * @param dayKey    local calendar date as `YYYY-MM-DD`
 * @param timeOfDay local wall clock as `HH:mm` or `HH:mm:ss`
 */
export function wallClockToInstant(dayKey: string, timeOfDay: string, timezone: string): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const [hour, minute, second] = timeOfDay.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    throw new RangeError(`Invalid wall clock: "${dayKey}" "${timeOfDay}"`);
  }

  const wall = utcFromFields(year, month, day, hour, minute, second || 0);

  // Offset arithmetic on KEY fields, not a rendered date — hardcoded en-CA
  // with an explicit hourCycle, never preferences.dateFormat. `hour12: false`
  // is not equivalent: it can render midnight as hour 24.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const offsetBefore = zoneOffsetMsAt(wall - MS_PER_DAY, fmt);
  const candidate = wall - offsetBefore;
  if (zoneOffsetMsAt(candidate, fmt) === offsetBefore) return new Date(candidate);

  const offsetAfter = zoneOffsetMsAt(wall + MS_PER_DAY, fmt);
  const alternate = wall - offsetAfter;
  if (zoneOffsetMsAt(alternate, fmt) === offsetAfter) return new Date(alternate);

  // Neither round-trips: the wall clock is in a gap. `candidate` is the one
  // computed from the pre-transition offset, which lands past the gap —
  // forward, per the policy above.
  return new Date(candidate);
}

/**
 * Shift a local calendar date key by whole days.
 *
 * Pure UTC calendar arithmetic, not 24-hour instant subtraction: `Date.UTC`
 * rolls months and years over correctly and has no DST, so "the previous
 * local date" stays exact across a transition, where subtracting 86,400,000
 * milliseconds can land on the wrong day.
 */
export function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const shifted = new Date(utcFromFields(year, month, day + days, 0, 0, 0));

  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * How many civil dates an export range may name, inclusive of both ends.
 *
 * A door policy, in the same sense as `MAX_INTERVAL_HOURS` — and it lives
 * here, next to the counting primitive, because BOTH export doors have to
 * spend the same budget. They did not: one said `> 366` and the other
 * `>= 366`, so the same request succeeded at `/api/export` and failed at
 * `/api/audit`. 366 is one leap year.
 */
export const MAX_EXPORT_RANGE_DAYS = 366;

/**
 * How many civil dates lie between two day keys, counting both ends.
 *
 * Counted from the KEYS, never from the elapsed milliseconds between two
 * instants, and that distinction is not pedantry. A zone can skip a
 * calendar date entirely: Pacific/Apia crossed the date line in 2011 and
 * 2011-12-30 never happened there. Measuring the range
 * `2010-12-31 … 2012-01-02` by instants gives 367 days elapsed, so a
 * cardinality derived from it reads 367 — while the range actually names
 * **368** dates. A 366-day cap let that through.
 *
 * Key arithmetic has no such hole: each key becomes UTC midnight, and UTC
 * has neither DST nor date-line politics, so the subtraction is exact for
 * every zone.
 */
export function inclusiveDayCount(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);

  const from = utcFromFields(fy, fm, fd, 0, 0, 0);
  const to = utcFromFields(ty, tm, td, 0, 0, 0);

  return Math.round((to - from) / MS_PER_DAY) + 1;
}

/**
 * Day of week (0 = Sunday) of a local calendar date key.
 *
 * Takes the key, never an instant. Reading the weekday off a resolved
 * instant is the bug this exists to prevent: `wallClockToInstant` may
 * legitimately return an instant on the following civil day, and a
 * day-of-week filter fed that instant drops the dose entirely.
 */
export function dayOfWeekForDayKey(dayKey: string): number {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(utcFromFields(year, month, day, 0, 0, 0)).getUTCDay();
}

/**
 * The label form: `isoDayKey` plus the locale's weekday name when asked.
 *
 * The weekday is a rendering choice and not part of the ISO promise, so it is
 * the one field here a locale still decides.
 */
function isoDate(date: Date, timezone: string, weekday: boolean): string {
  const ymd = isoDayKey(date, timezone);
  if (!weekday) return ymd;

  const dayName = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short" })
    .formatToParts(date)
    .find((part) => part.type === "weekday")?.value;

  return dayName ? `${dayName}, ${ymd}` : ymd;
}

export interface UserDateOptions {
  /** Prefix an abbreviated weekday ("Wed"). */
  weekday?: boolean;
  /** Include the year. Ignored for `YYYY-MM-DD`, which always carries one. */
  year?: boolean;
}

/**
 * Render a date in the user's timezone and preferred date format. This is
 * the canonical date formatter — the counterpart to formatUserTime(), and
 * the only place the user's `preferences.dateFormat` is read.
 *
 * The split of responsibilities matters and is not negotiable per call
 * site: **the preference owns field order and numeric-vs-named month; the
 * call site owns which fields appear**. A day-group heading wants a weekday
 * and no year, a clinician-facing report wants both — but neither gets to
 * decide whether the day precedes the month, because that is the setting.
 *
 * `YYYY-MM-DD` is the one value whose label is literally an all-numeric
 * pattern, so it forces numeric month/day and a year: an ISO date with a
 * named month or no year is not an ISO date. It is also the one value a
 * locale cannot be trusted to produce, so it is assembled by `isoDate`.
 *
 * NOT for date *keys*. Anything compared, grouped or round-tripped needs a
 * stable `YYYY-MM-DD` and must keep its own hardcoded `en-CA` formatter —
 * see the comment on `formatDateKey` in `(app)/log/+page.svelte` and on the
 * date cell in `server/export-csv.ts`.
 */
export function formatUserDate(
  date: Date,
  timezone: string,
  dateFormat: DateFormat = "DD/MM/YYYY",
  { weekday = false, year = true }: UserDateOptions = {},
): string {
  if (dateFormat === "YYYY-MM-DD") return isoDate(date, timezone, weekday);

  return new Intl.DateTimeFormat(DATE_FORMAT_LOCALES[dateFormat], {
    timeZone: timezone,
    ...(weekday ? { weekday: "short" as const } : {}),
    ...(year ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
  }).format(date);
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether `YYYY-MM-DD` names a day that actually exists.
 *
 * A shape check is not a calendar check: `/^\d{4}-\d{2}-\d{2}$/` matches
 * `2026-13-45` and `2026-02-31` quite happily, and `Date` then NORMALISES
 * them — to 2027-01-14 and 3 March respectively — rather than rejecting
 * them. Silent normalisation is the wrong answer at a door: a user who
 * typed a nonsense date wants to be told, not to be shown April 2027's
 * dose log without explanation.
 *
 * The round-trip catches both out-of-range components and dates that do not
 * exist. It goes through `utcFromFields` so it is right for years below 100,
 * where `Date.UTC` maps two-digit years into the 1900s and would reject a
 * perfectly good year 50.
 */
export function isCalendarDay(year: number, month: number, day: number): boolean {
  const probe = new Date(utcFromFields(year, month, day, 0, 0, 0));

  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Whether a `YYYY-MM-DD` string names a day that actually exists. */
export function isCalendarDayKey(dayKey: string): boolean {
  if (!DAY_KEY_RE.test(dayKey)) return false;
  const [year, month, day] = dayKey.split("-").map(Number);
  return isCalendarDay(year, month, day);
}

/**
 * A `?from=` / `?to=` query param as an instant, reading a bare `YYYY-MM-DD`
 * as a civil day in the USER'S timezone.
 *
 * Four doors spelled this as `new Date(dateOnlyString)`, which the spec
 * parses as UTC midnight — beside SQL that groups on
 * `AT TIME ZONE <profile tz>`. Two consequences, both wrong every day rather
 * than twice a year:
 *
 *   * `to=2026-04-15` bounded the query at 00:00Z on the 15th, so for a
 *     user east of UTC the entire end day was excluded. Asking for "up to
 *     15 April" returned nothing from 15 April.
 *   * `from=2026-04-15` started at 00:00Z, which for a user west of UTC is
 *     still the 14th locally, so the range quietly included part of the day
 *     before the one requested.
 *
 * The `end` edge returns the EXCLUSIVE start of the next civil day, so
 * callers compare with `lt` rather than `lte` and the whole requested day is
 * inside the range whatever its length. Returning "23:59:59.999" instead
 * would re-introduce a sub-second hole for no benefit.
 *
 * A value that is not a bare day key falls through to `new Date`, so the
 * full-ISO form the API doors also accept keeps working; anything
 * unparseable comes back as null rather than an `Invalid Date`. That last
 * part is not cosmetic — Drizzle calls `toISOString()` on whatever it is
 * given, so an `Invalid Date` reached the driver and threw a `RangeError`
 * from inside a `load`, which SvelteKit renders as a 500. `/log?from=x` was
 * a 500 on a page where page, status, q and withSideEffects were all
 * validated and only the dates were not.
 */
export function parseDayRangeParam(
  value: string | null | undefined,
  timezone: string,
  edge: "start" | "end",
): Date | null {
  if (!value) return null;

  if (DAY_KEY_RE.test(value)) {
    // A shape-only check would silently NORMALISE `2026-13-99` into April
    // 2027 and hand back an empty log with no explanation. Rejected instead,
    // which the caller reads as "no bound" — the same treatment the import
    // door gives a bad date cell.
    if (!isCalendarDayKey(value)) return null;
    const dayKey = edge === "end" ? shiftDayKey(value, 1) : value;
    return wallClockToInstant(dayKey, "00:00", timezone);
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Render an instant as a datetime-local input value (`YYYY-MM-DDTHH:mm`) in
 * the given IANA timezone — the exact inverse of {@link parseDateTimeLocal},
 * and the reason it exists.
 *
 * The dose-edit form used to build this with
 * `d.setMinutes(d.getMinutes() - d.getTimezoneOffset())`, which is the
 * BROWSER's offset, while the server parsed the value back in the user's
 * PROFILE timezone. Opening the modal and pressing Save without touching
 * anything therefore moved the timestamp by the difference — every day of
 * the year, not just on a transition — for anyone travelling or running a
 * device set to a different region.
 *
 * Assembled from `formatToParts` rather than a locale's rendering, for the
 * same reason `isoDayKey` is: this is a machine-read key, and field order
 * and separator are CLDR data that is allowed to change.
 */
export function formatDateTimeLocal(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return (
    `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}` +
    `T${get("hour")}:${get("minute")}`
  );
}

/**
 * The instant a dose-edit submission means, given what it started as.
 *
 * A `datetime-local` value cannot express WHICH of two instants it names on
 * a fall-back day. Europe/London 2026-10-25 has 01:30 twice — 00:30Z and
 * 01:30Z — and both render as "2026-10-25T01:30". `parseDateTimeLocal`
 * resolves that to the earlier one by policy, so a dose stored at the second
 * occurrence, opened and saved WITHOUT TOUCHING ANYTHING, silently moved an
 * hour earlier. One hour a year, but it corrupts the history that adherence,
 * the heatmap and refill forecasting are computed from.
 *
 * The form carries the instant it rendered. If the submitted wall clock is
 * the one that instant renders as, nothing was edited and the original
 * instant is returned unchanged — which also preserves sub-minute precision
 * the `HH:mm` control cannot show. Anything else is a real edit and resolves
 * normally, taking the documented earlier-of-two policy.
 *
 * Comparing rendered forms rather than trusting a flag is deliberate: it
 * cannot be fooled by a client that submits a stale `originalTakenAt`
 * alongside a genuinely changed time, because the two would not match.
 */
export function resolveEditedInstant(
  datetimeLocal: string,
  originalIso: string | undefined,
  timezone: string,
): Date {
  if (originalIso) {
    const original = new Date(originalIso);
    if (
      !Number.isNaN(original.getTime()) &&
      formatDateTimeLocal(original, timezone) === datetimeLocal.slice(0, 16)
    ) {
      return original;
    }
  }

  return parseDateTimeLocal(datetimeLocal, timezone);
}

/**
 * Parse a datetime-local input value (e.g. "2026-04-15T18:20") as a Date in
 * the given IANA timezone. datetime-local carries no zone, so the wall clock
 * it names has to be resolved — which is `wallClockToInstant`'s whole job.
 *
 * This is the write path for `dose_logs.takenAt`, so its gap and overlap
 * policies are the ones a user's stored history inherits.
 */
export function parseDateTimeLocal(datetimeLocal: string, timezone: string): Date {
  const [dayKey, timeOfDay] = datetimeLocal.split("T");
  if (!dayKey || !timeOfDay) {
    throw new RangeError(`Invalid datetime-local value: "${datetimeLocal}"`);
  }

  return wallClockToInstant(dayKey, timeOfDay, timezone);
}

/**
 * Format a duration in milliseconds as a human-readable "due in" string.
 * Positive ms = time until due. Negative ms = overdue. Near-zero = "Due now".
 */
export function formatDueIn(ms: number): string {
  const absMins = Math.floor(Math.abs(ms) / 60_000);
  if (absMins < 1) return "Due now";

  const hours = Math.floor(absMins / 60);
  const mins = absMins % 60;

  let label: string;
  if (hours > 0 && mins > 0) {
    label = `${hours}h ${mins}m`;
  } else if (hours > 0) {
    label = `${hours}h`;
  } else {
    label = `${mins}m`;
  }

  return ms > 0 ? `Due in ${label}` : `Overdue ${label}`;
}

/**
 * Compute the timing status for a scheduled medication.
 * @param intervalHours - the schedule interval in hours
 * @param lastEventAt   - when the medication was last *handled* — taken
 *                        OR skipped. Both advance the clock so the user
 *                        can dismiss an overdue slot by skipping it.
 *                        `null` if the schedule has never been touched.
 * @param now           - current timestamp (for testability)
 * @returns status and minutesUntilDue (negative if overdue)
 */
export function computeTimingStatus(
  intervalHours: number,
  lastEventAt: Date | null,
  now: Date = new Date(),
): {
  status: "ok" | "due_soon" | "due_now" | "overdue";
  minutesUntilDue: number;
} {
  if (!lastEventAt) {
    // Never handled — treat as overdue
    return { status: "overdue", minutesUntilDue: -1 };
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  const nextDueAt = lastEventAt.getTime() + intervalMs;
  const msUntilDue = nextDueAt - now.getTime();
  return {
    status: classifyDueStatus(msUntilDue),
    minutesUntilDue: Math.round(msUntilDue / 60_000),
  };
}

/**
 * Shared due-ness thresholds: overdue if more than a minute past due,
 * due_now within ±1 minute, due_soon within the next hour. Used by
 * both the interval-based computeTimingStatus above and the slot-based
 * timing in $lib/utils/schedule.ts so the QuickLogBar badges mean the
 * same thing for every schedule kind.
 */
export function classifyDueStatus(msUntilDue: number): "ok" | "due_soon" | "due_now" | "overdue" {
  if (msUntilDue <= -60_000) return "overdue";
  if (msUntilDue <= 60_000) return "due_now";
  if (msUntilDue <= 60 * 60_000) return "due_soon";
  return "ok";
}

/**
 * The instant at which `date`'s civil day begins in `timezone`.
 *
 * Two steps, each owned elsewhere: ask `isoDayKey` which civil day the
 * instant falls on, then ask `wallClockToInstant` when midnight on that day
 * happened. The previous implementation fused them into one anchor-and-
 * correct expression and was wrong in two distinct ways.
 *
 * The serious one had nothing to do with DST. It anchored on
 * `<dayKey>T12:00:00.000Z` and subtracted the local time-of-day read there —
 * but at UTC+12 and beyond, noon UTC is ALREADY the next civil day locally,
 * so the time-of-day read back was 00:00, the correction subtracted nothing,
 * and the function returned *tomorrow's* midnight. Every day of the year,
 * for all 18 zones at or east of UTC+12 (Auckland, Fiji, Kiritimati,
 * Chatham, Tongatapu, Kamchatka…). Since `getTodaysDoses` filters on
 * `takenAt >= dayStart`, a New Zealand user's dashboard listed no doses at
 * all, permanently, and My Day projected tomorrow's slots. Its one test used
 * "UTC" — the single zone that can expose neither failure.
 *
 * Local midnight does not always exist (America/Santiago, America/Havana and
 * Africa/Cairo spring forward at 00:00), which is why the gap policy has to
 * be forward: resolving backwards would put the day's start on the previous
 * civil day and pull a whole extra day of doses into "today".
 */
export function startOfDay(date: Date, timezone: string): Date {
  return wallClockToInstant(isoDayKey(date, timezone), "00:00", timezone);
}

/**
 * The instant at which `date`'s civil day ends in `timezone` — i.e. when the
 * next one begins.
 *
 * Exists because `dayStart + 24h` is wrong twice a year in every DST zone: a
 * civil day is 23, 24, 24.5 or 25 hours long. Measured on Europe/London
 * 2026-10-25, a 25-hour day, the fixed offset ended the window at 23:00
 * local and dropped every dose scheduled in the last hour — 23:00–23:59,
 * the most common bedtime-medication slot.
 */
export function endOfDay(date: Date, timezone: string): Date {
  return wallClockToInstant(shiftDayKey(isoDayKey(date, timezone), 1), "00:00", timezone);
}
