import { json } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";

/**
 * Unauthenticated liveness probe for uptime monitors.
 *
 * Intentionally cheap: no database calls, no auth, no version info.
 * Safe to poll at high frequency.
 */
export const GET: RequestHandler = () => {
  return json(
    {
      ok: true,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
};
