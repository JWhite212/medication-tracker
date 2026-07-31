import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireApiUser } from "$lib/server/api/auth";
import { runCommands } from "$lib/server/api/commands";
import { readJson } from "$lib/server/api/read-json";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { rateLimitedResponse } from "$lib/server/api/rate-limit-response";

const body = z.object({
  commands: z
    .array(z.object({ id: z.string().min(1), type: z.string().min(1), payload: z.unknown() }))
    .max(200),
});

export const POST: RequestHandler = async ({ request }) => {
  const { user } = await requireApiUser(request);

  // Generous per-user cap. Each request already carries up to 200
  // commands, so this bounds abuse without throttling normal outbox
  // drains.
  const { allowed, retryAfterMs } = await checkRateLimit(`api-commands:${user.id}`, 60, 60_000);
  if (!allowed) return rateLimitedResponse(retryAfterMs);

  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) throw error(400, "Invalid commands payload");
  return json({ results: await runCommands(user.id, parsed.data.commands) });
};
