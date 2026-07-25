// GET /api/v1/export/full — versioned, round-trippable JSON snapshot of
// the whole account (backup / data-portability). Distinct from the web
// `/api/export` route (dose CSV/PDF export) — this is the native/API
// counterpart, gated by bearer auth + a tight rate limit since it's a
// full-account dump.
import type { RequestHandler } from "@sveltejs/kit";
import { requireApiUser } from "$lib/server/api/auth";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { buildFullExport } from "$lib/server/api/export";

export const GET: RequestHandler = async ({ request }) => {
  const { user } = await requireApiUser(request);

  const { allowed, retryAfterMs } = await checkRateLimit(
    `api-export:${user.id}`,
    10,
    15 * 60 * 1000,
  );
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return new Response(JSON.stringify({ error: "rate_limited", retryAfterSeconds }), {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds), "content-type": "application/json" },
    });
  }

  const data = await buildFullExport(user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="medtracker-backup-${date}.json"`,
    },
  });
};
