import { error, json } from "@sveltejs/kit";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { getAuditLogForExport, buildAuditCsv } from "$lib/server/audit-export";
import type { RequestHandler } from "./$types";
import { parseDayRangeParam, isoDayKey } from "$lib/utils/time";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, "Unauthorized");

  const { allowed, retryAfterMs } = await checkRateLimit(
    `audit-export:${locals.user.id}`,
    RATE_MAX_REQUESTS,
    RATE_WINDOW_MS,
  );
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

  const fromDate = parsedFrom ?? new Date(Date.now() - 365 * 86400000);
  const toDate = parsedTo ?? new Date();
  if (fromDate >= toDate) {
    error(400, "'from' must be before 'to'");
  }
  // Measured in whole CIVIL days, not raw milliseconds. `toDate` is the
  // exclusive start of the day after the requested end, so the requested span
  // is one shorter than the delta; and the delta itself is not a multiple of
  // 86,400,000 once a range straddles a DST transition, which made the SAME
  // request pass or fail depending only on the caller's profile timezone.
  // is one shorter than the delta; and the delta itself is not a multiple of
  // 86,400,000 once a range straddles a DST transition, which made the SAME
  // request pass or fail depending only on the caller's profile timezone.
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) - 1;
  const spanDays = Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) - 1;
  if (spanDays >= 366) {
    error(400, "Date range must not exceed 1 year");
  }

  const rows = await getAuditLogForExport(locals.user.id, fromDate, toDate);
  const csv = buildAuditCsv(rows);
  // The civil day is asked for, not read off the instant: `fromDate` is a
  // LOCAL midnight now, so `toISOString()` names the previous UTC date for
  // every user east of UTC. See the invariant on `wallClockToInstant`.
  const dateStr = isoDayKey(fromDate, tz);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="medtracker-audit-${dateStr}.csv"`,
    },
  });
};
