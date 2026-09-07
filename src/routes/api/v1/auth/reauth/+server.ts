import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { requireApiUser } from "$lib/server/api/auth";
import { readJson } from "$lib/server/api/read-json";
import { confirmReauth, REAUTH_PURPOSES } from "$lib/server/auth/reauth";
import { rateLimitedResponse } from "$lib/server/api/rate-limit-response";

/**
 * Mint a short-lived re-authentication token for a destructive command.
 *
 * The browser has always required a password before wiping dose history —
 * `settings/privacy` prompts for one and runs it through `confirmReauth`.
 * `/api/v1/commands` required nothing at all, so a stolen bearer token was
 * sufficient to irreversibly delete a user's entire dose log through the
 * same code path the web UI guards. Two doors, one destructive action, one
 * of them unguarded.
 *
 * This is the API's half of that gate, and it is deliberately the same
 * mechanism rather than a parallel one: `confirmReauth` mints, this returns
 * the raw token, and `requireRecentReauth` redeems it single-use inside the
 * command handler. That redeem function was built with the token half of
 * the reauth design and had ZERO callers until now.
 *
 * Rate limiting lives inside `confirmReauth`, per account — the same budget
 * the browser doors spend, deliberately shared so an attacker cannot get a
 * fresh allowance by switching transport.
 */
const body = z.object({
  password: z.string().min(1),
  purpose: z.enum(REAUTH_PURPOSES),
});

export const POST: RequestHandler = async ({ request }) => {
  const { user } = await requireApiUser(request);

  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) throw error(400, "Invalid reauth payload");

  const reauth = await confirmReauth(user.id, parsed.data.password, parsed.data.purpose);
  if (reauth.rateLimited) return rateLimitedResponse(reauth.retryAfterMs ?? 0);
  if (!reauth.ok) throw error(401, "Incorrect password");

  // An OAuth-only account has no password to confirm, so `confirmReauth`
  // cannot mint for it and the destructive commands stay closed at this
  // door. That is the same position the browser is in for those accounts on
  // the privacy page, which also has no alternative confirmation there.
  return json({ reauthToken: reauth.token, expiresInMs: 5 * 60 * 1000 });
};
