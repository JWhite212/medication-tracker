import { json, error } from "@sveltejs/kit";
import { checkInteractions, isInteractionsEnabled } from "$lib/server/interactions";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import type { RequestHandler } from "@sveltejs/kit";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 30;

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401);
  if (!isInteractionsEnabled()) return json({ warnings: [], enabled: false });

  const rateKey = `interactions:${locals.user.id}`;
  const { allowed, retryAfterMs } = await checkRateLimit(rateKey, MAX_REQUESTS, WINDOW_MS);
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

  const drug = url.searchParams.get("drug");
  if (!drug || drug.length < 2) return json({ warnings: [], enabled: true });

  const warnings = await checkInteractions(locals.user.id, drug);
  return json({ warnings, enabled: true });
};
