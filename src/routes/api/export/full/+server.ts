// GET /api/export/full — full-account JSON backup for the web UI.
//
// The same snapshot as /api/v1/export/full, which is bearer-auth only
// and therefore reachable by the macOS client but not from a browser.
// Without this route a web user has no way to download a file that
// /settings/data/import can actually read: the other web exports are a
// rendered PDF and a lossy dose CSV.
import { error, json } from "@sveltejs/kit";
import { buildFullExport } from "$lib/server/api/export";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import type { RequestHandler } from "./$types";

const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_REQUESTS = 10;

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) error(401, "Unauthorized");

  const { allowed, retryAfterMs } = await checkRateLimit(
    `export-full:${locals.user.id}`,
    RATE_MAX_REQUESTS,
    RATE_WINDOW_MS,
  );
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: "rate_limited", retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const data = await buildFullExport(locals.user.id);
  const date = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="medtracker-backup-${date}.json"`,
    },
  });
};
