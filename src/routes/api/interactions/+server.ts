import { json, error } from "@sveltejs/kit";
import { checkInteractions, isInteractionsEnabled } from "$lib/server/interactions";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401);
  if (!isInteractionsEnabled()) return json({ warnings: [], enabled: false });

  const { allowed, retryAfterMs } = await enforceLimit(LIMITS.interactions, locals.user.id);
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
