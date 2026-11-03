import { error, fail } from "@sveltejs/kit";
import type { z } from "zod";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { getActiveMedications } from "$lib/server/medications";
import { getSchedulesForUser } from "$lib/server/schedules";
import { dashboardVariantFor } from "$lib/server/dashboard/page-data";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import { dashboardSettingsFieldSchemas } from "$lib/utils/validation";
import type { UserPreferences } from "$lib/types";
import type { Actions, PageServerLoad, RequestEvent } from "./$types";

/**
 * The layout's whole reset, written once: one `updatePreferences` call, so
 * one write and one audit row rather than four.
 */
const RESET_LAYOUT = {
  dashboardSectionOrder: null,
  dashboardShowLater: true,
  dashboardShowQuickLog: true,
  dashboardShowRefills: true,
} as const satisfies Partial<UserPreferences>;

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;
  // The same two reads the dashboard's load makes, both scoped by user_id;
  // getActiveMedications excludes archived medications, and
  // dashboardVariantFor reads only their schedule rows.
  const [preferences, medications, schedulesByMedId] = await Promise.all([
    getOrCreatePreferences(userId),
    getActiveMedications(userId),
    getSchedulesForUser(userId),
  ]);
  return { preferences, variant: dashboardVariantFor(medications, schedulesByMedId) };
};

/**
 * Auth, then the budget, in that order, for every action here. The same
 * shape as Appearance's `fieldAction`, so the page's client reads one
 * failure contract: `fail(429, { key, saveError, retryAfterMs })`.
 */
async function admit(key: string, locals: App.Locals) {
  // Form actions run BEFORE layout load functions, so the (app) group's
  // auth guard has not executed at this point.
  if (!locals.user) error(401, "Unauthorized");
  const userId = locals.user.id;

  const { allowed, retryAfterMs } = await enforceLimit(LIMITS.dashboardSettingsSave, userId);
  if (!allowed) {
    return {
      userId,
      refused: fail(429, {
        key,
        saveError: `Too many changes. Try again in ${Math.ceil(retryAfterMs / 1000)} seconds.`,
        retryAfterMs,
      }),
    };
  }
  return { userId, refused: null };
}

/** One named action per field: a strict schema with exactly one required key. */
function fieldAction(
  key: Exclude<keyof typeof dashboardSettingsFieldSchemas, "timeSinceDaysFromHours">,
) {
  const schema: z.ZodType<Partial<UserPreferences>> = dashboardSettingsFieldSchemas[key];
  return async ({ request, locals }: RequestEvent) => {
    const { userId, refused } = await admit(key, locals);
    if (refused) return refused;

    const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) {
      return fail(400, { key, errors: parsed.error.flatten().fieldErrors });
    }

    await updatePreferences(userId, parsed.data);
    return { success: true, key };
  };
}

export const actions = {
  dashboardSectionOrder: fieldAction("dashboardSectionOrder"),
  dashboardShowLater: fieldAction("dashboardShowLater"),
  dashboardShowQuickLog: fieldAction("dashboardShowQuickLog"),
  dashboardShowRefills: fieldAction("dashboardShowRefills"),
  resetDashboardLayout: async ({ locals }) => {
    const { userId, refused } = await admit("resetDashboardLayout", locals);
    if (refused) return refused;

    await updatePreferences(userId, RESET_LAYOUT);
    return { success: true, key: "resetDashboardLayout" };
  },
} satisfies Actions;
