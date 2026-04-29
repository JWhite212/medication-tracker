import { json, error } from "@sveltejs/kit";
import { checkInteractions, isInteractionsEnabled } from "$lib/server/interactions";
import type { RequestHandler } from "@sveltejs/kit";

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.user) throw error(401);
  if (!isInteractionsEnabled()) return json({ warnings: [], enabled: false });

  const drug = url.searchParams.get("drug");
  if (!drug || drug.length < 2) return json({ warnings: [], enabled: true });

  const warnings = await checkInteractions(locals.user.id, drug);
  return json({ warnings, enabled: true });
};
