// GET /api/export/full — full-account JSON backup for the web UI.
//
// The same snapshot as /api/v1/export/full, which is bearer-auth only
// and therefore reachable by the macOS client but not from a browser.
// Without this route a web user has no way to download a file that
// /settings/data/import can actually read: the other web exports are a
// rendered PDF and a lossy dose CSV.
import { error, json } from "@sveltejs/kit";
import { buildFullExport } from "$lib/server/api/export";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import { isoDayKey } from "$lib/utils/time";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, "Unauthorized");

  const { allowed, retryAfterMs } = await enforceLimit(LIMITS.exportFull, locals.user.id);
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: "rate_limited", retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const data = await buildFullExport(locals.user.id);
  // The user's civil date, like the dose and audit exports beside it, not the
  // UTC date: `toISOString()` names yesterday for an Auckland user before
  // midday. The /api/v1 door keeps its documented UTC filename.
  const date = isoDayKey(new Date(), locals.user.timezone);

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="medtracker-backup-${date}.json"`,
    },
  });
};
