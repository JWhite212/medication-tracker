import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { requireApiUser } from "$lib/server/api/auth";
import { buildSyncResponse } from "$lib/server/api/sync";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { rateLimitedResponse } from "$lib/server/api/rate-limit-response";

export const GET: RequestHandler = async ({ request, url }) => {
  const { user } = await requireApiUser(request);

  // Generous per-user cap: a client may sync on launch, foreground, and
  // after each command drain, so this only stops a runaway loop.
  const { allowed, retryAfterMs } = await checkRateLimit(`api-sync:${user.id}`, 120, 60_000);
  if (!allowed) return rateLimitedResponse(retryAfterMs);

  const since = url.searchParams.get("since");
  if (since !== null && Number.isNaN(Date.parse(since))) {
    throw error(400, "invalid since parameter");
  }
  const epoch = Number(url.searchParams.get("epoch") ?? "0") || 0;
  return json(await buildSyncResponse(user.id, since, epoch));
};
