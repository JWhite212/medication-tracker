import { error, json } from "@sveltejs/kit";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { getAuditLogForExport, buildAuditCsv } from "$lib/server/audit-export";
import type { RequestHandler } from "./$types";

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
  const fromDate = from ? new Date(from) : new Date(Date.now() - 365 * 86400000);
  const toDate = to ? new Date(to) : new Date();

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    error(400, "Invalid date format");
  }
  if (fromDate >= toDate) {
    error(400, "'from' must be before 'to'");
  }
  if (toDate.getTime() - fromDate.getTime() > 366 * 86400000) {
    error(400, "Date range must not exceed 1 year");
  }

  const rows = await getAuditLogForExport(locals.user.id, fromDate, toDate);
  const csv = buildAuditCsv(rows);
  const dateStr = fromDate.toISOString().split("T")[0];

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="medtracker-audit-${dateStr}.csv"`,
    },
  });
};
