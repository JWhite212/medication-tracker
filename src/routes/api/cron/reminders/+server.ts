import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { checkOverdueMedications } from "$lib/server/reminders";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    error(401, "Unauthorized");
  }
  await checkOverdueMedications();
  return json({ ok: true });
};
