import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { requireApiUser } from "$lib/server/api/auth";
import { buildSyncResponse } from "$lib/server/api/sync";

export const GET: RequestHandler = async ({ request, url }) => {
  const { user } = await requireApiUser(request);
  const since = url.searchParams.get("since");
  if (since !== null && Number.isNaN(Date.parse(since))) {
    throw error(400, "invalid since parameter");
  }
  const epoch = Number(url.searchParams.get("epoch") ?? "0") || 0;
  return json(await buildSyncResponse(user.id, since, epoch));
};
