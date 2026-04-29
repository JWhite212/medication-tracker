import { fail } from "@sveltejs/kit";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { appearanceSchema } from "$lib/utils/validation";
import { logAudit, computeChanges } from "$lib/server/audit";
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

    const before = await getOrCreatePreferences(locals.user!.id);
    const updated = await updatePreferences(locals.user!.id, parsed.data);

    const changes = computeChanges(
      {
        accentColor: before.accentColor,
        dateFormat: before.dateFormat,
        timeFormat: before.timeFormat,
        uiDensity: before.uiDensity,
        reducedMotion: before.reducedMotion,
      },
      {
        accentColor: updated.accentColor,
        dateFormat: updated.dateFormat,
        timeFormat: updated.timeFormat,
        uiDensity: updated.uiDensity,
        reducedMotion: updated.reducedMotion,
      },
    );
    if (changes)
      await logAudit(locals.user!.id, "user_preferences", locals.user!.id, "update", changes);

    return { success: true };
  },
};
