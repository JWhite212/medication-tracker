import { redirect } from "@sveltejs/kit";
import { getOrCreatePreferences } from "$lib/server/preferences";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, "/auth/login");
  const preferences = await getOrCreatePreferences(locals.user.id);
  return { user: locals.user, preferences };
};
