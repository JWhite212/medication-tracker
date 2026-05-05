import { fail, redirect } from "@sveltejs/kit";
import { medicationSchema, schedulesSchema } from "$lib/utils/validation";
import { createMedicationWithSchedules } from "$lib/server/medications";
import type { Actions } from "./$types";

function parseSchedules(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = medicationSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        values: formData,
      });
    }

    const schedulesParsed = schedulesSchema.safeParse(parseSchedules(formData.schedules));
    if (!schedulesParsed.success) {
      return fail(400, {
        errors: { schedules: ["Add at least one valid schedule row"] },
        values: formData,
      });
    }

    // Single-transaction service: medication + schedules + audit
    // commit or roll back together, so a failed schedule insert
    // cannot leave an orphaned medication row.
    await createMedicationWithSchedules(locals.user!.id, parsed.data, schedulesParsed.data);
    redirect(302, "/medications");
  },
};
