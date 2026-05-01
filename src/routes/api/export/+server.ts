import { error, json } from "@sveltejs/kit";
import { generateReport } from "$lib/server/export-pdf";
import { generateCsvReport } from "$lib/server/export-csv";
import { getOrCreatePreferences } from "$lib/server/preferences";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import type { RequestHandler } from "./$types";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) error(401, "Unauthorized");

  const rateKey = `export:${locals.user.id}`;
  const { allowed, retryAfterMs } = await checkRateLimit(
    rateKey,
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
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
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

  const preferences = await getOrCreatePreferences(locals.user.id);
  const format = url.searchParams.get("format") ?? preferences.exportFormat ?? "pdf";
  const dateStr = fromDate.toISOString().split("T")[0];
  const timeFormat = preferences.timeFormat as "12h" | "24h";

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
  );

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="medtracker-report-${dateStr}.pdf"`,
    },
  });
};
