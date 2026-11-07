import { error, json } from "@sveltejs/kit";
import { generateReport } from "$lib/server/export-pdf";
import { generateCsvReport } from "$lib/server/export-csv";
import { getOrCreatePreferences } from "$lib/server/preferences";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import {
  parseDayRangeParam,
  isoDayKey,
  shiftDayKey,
  wallClockToInstant,
  inclusiveDayCount,
  MAX_EXPORT_RANGE_DAYS,
  type DateFormat,
} from "$lib/utils/time";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, "Unauthorized");

  const { allowed, retryAfterMs } = await enforceLimit(LIMITS.exportReport, locals.user.id);
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: "rate_limited", retryAfterSeconds },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Bare YYYY-MM-DD params are civil days in the USER'S timezone, not UTC
  // midnights — see parseDayRangeParam. The `to` bound it returns is
  // exclusive, so the whole requested end day is inside the range; the
  // queries below compare with `lt`.
  const tz = locals.user.timezone;
  const parsedFrom = parseDayRangeParam(from, tz, "start");
  const parsedTo = parseDayRangeParam(to, tz, "end");
  if ((from && !parsedFrom) || (to && !parsedTo)) {
    error(400, "Invalid date format");
  }

  const preferences = await getOrCreatePreferences(locals.user.id);
  const format = url.searchParams.get("format") ?? preferences.exportFormat ?? "pdf";

  // The default window is CIVIL DAYS, like an explicit one. It used to be the
  // rolling instant `now − 30×24h`, which the PDF header and the filename then
  // labelled as a whole civil date: a London user exporting at 14:37 got a
  // report headed "7 Oct" whose 7 Oct omitted the 08:00 dose, so the first
  // labelled morning read as missed. Every export button omits from/to, so
  // this was the only window a web user ever saw.
  //
  // The start is local midnight 30 days back. The PDF ends at today's local
  // midnight (exclusive), i.e. the last 30 COMPLETE days: ending at `now`
  // makes `clampEffectiveDays` floor the partial today while today's doses
  // still count (a spurious Overuse line), and ending at tomorrow's midnight
  // charges today's not-yet-due slots as Missed. The CSV is a data export
  // with no expected-dose arithmetic, so it keeps ending at `now` and still
  // carries today's doses, as it always has. A request naming only `from`
  // keeps ending at `now` too: it asked for "from then on", not for the
  // default window, and today's midnight would refuse a `from` of today.
  const todayKey = isoDayKey(new Date(), tz);
  const fromDate = parsedFrom ?? wallClockToInstant(shiftDayKey(todayKey, -30), "00:00", tz);
  const toDate =
    parsedTo ??
    (format === "csv" || parsedFrom ? new Date() : wallClockToInstant(todayKey, "00:00", tz));
  if (fromDate >= toDate) {
    error(400, "'from' must be before 'to'");
  }
  // Counted as CIVIL DATES from the day keys, not as elapsed milliseconds.
  // A zone can skip a date outright — Pacific/Apia's 2011-12-30 never
  // happened — so an instant-derived count reads one day short there and let
  // an over-long range through. `inclusiveDayCount` is exact for every zone,
  // and both export doors spend the same budget from the same constant; they
  // previously disagreed by a day.
  const lastIncludedKey = isoDayKey(new Date(toDate.getTime() - 1), tz);
  if (inclusiveDayCount(isoDayKey(fromDate, tz), lastIncludedKey) > MAX_EXPORT_RANGE_DAYS) {
    error(400, "Date range must not exceed 1 year");
  }

  // The civil day is asked for, not read off the instant: `fromDate` is a
  // LOCAL midnight now, so `toISOString()` names the previous UTC date for
  // every user east of UTC. See the invariant on `wallClockToInstant`.
  const dateStr = isoDayKey(fromDate, tz);
  const timeFormat = preferences.timeFormat as "12h" | "24h";
  const dateFormat = preferences.dateFormat as DateFormat;

  if (format === "csv") {
    const csv = await generateCsvReport(
      locals.user.id,
      locals.user.timezone,
      fromDate,
      toDate,
      timeFormat,
    );
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="medtracker-report-${dateStr}.csv"`,
      },
    });
  }

  const pdf = await generateReport(
    locals.user.id,
    locals.user.timezone,
    fromDate,
    toDate,
    locals.user.name,
    timeFormat,
    dateFormat,
  );

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="medtracker-report-${dateStr}.pdf"`,
    },
  });
};
