import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireApiUser } from "$lib/server/api/auth";
import { runCommands } from "$lib/server/api/commands";
import { readJson } from "$lib/server/api/read-json";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import { rateLimitedResponse } from "$lib/server/api/rate-limit-response";

// `runCommands` works through up to 200 commands one after another, each a
// reserve, a dispatch and a result write against Neon, so a Mac outbox
// drained after a long offline spell can outrun the platform's default
// function limit (10s, per the note in api/cron/reminders/+server.ts). That
// is the predictable way to reach the ledger's "died without cleaning up"
// state: the command in flight when the function is killed keeps its
// null-result reservation, and every replay of its id answers `in_progress`
// for good (docs/api-v1-contract.md, Idempotency). 60 is the Hobby maximum
// and matches the cron and import routes; if a build rejects it, lower it to
// the cap the error names rather than deleting it.
//
// This narrows the window, it does not close it. A kill at any limit still
// strands the one command in flight (its mutation may or may not have
// committed, which is why the ledger fails closed rather than re-running
// it); the commands after it were never reserved and can be retried. The
// client reconciles a stranded id through /sync.
const MAX_DURATION_SECONDS = 60;
export const config = { maxDuration: MAX_DURATION_SECONDS };

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
  const { allowed, retryAfterMs } = await enforceLimit(LIMITS.apiCommands, user.id);
  if (!allowed) return rateLimitedResponse(retryAfterMs);

  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) throw error(400, "Invalid commands payload");
  return json({ results: await runCommands(user.id, parsed.data.commands) });
};
