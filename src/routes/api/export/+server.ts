import { error, json } from "@sveltejs/kit";
import { generateReport } from "$lib/server/export-pdf";
import { generateCsvReport } from "$lib/server/export-csv";
import { getOrCreatePreferences } from "$lib/server/preferences";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import {
  parseDayRangeParam,
  isoDayKey,
  inclusiveDayCount,
  MAX_EXPORT_RANGE_DAYS,
  type DateFormat,
} from "$lib/utils/time";
import type { RequestHandler } from "./$types";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;

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

  const fromDate = parsedFrom ?? new Date(Date.now() - 30 * 86400000);
  const toDate = parsedTo ?? new Date();
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

  const preferences = await getOrCreatePreferences(locals.user.id);
  const format = url.searchParams.get("format") ?? preferences.exportFormat ?? "pdf";
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
