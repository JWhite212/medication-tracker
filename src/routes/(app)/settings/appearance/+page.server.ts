import { fail } from "@sveltejs/kit";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { appearanceSchema } from "$lib/utils/validation";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const prefs = await getOrCreatePreferences(locals.user!.id);
  return { preferences: prefs };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = appearanceSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    await updatePreferences(locals.user!.id, parsed.data);

    return { success: true };
  },
};
