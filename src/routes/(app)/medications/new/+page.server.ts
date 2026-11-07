import { error, redirect } from "@sveltejs/kit";
import { parseMedicationForm } from "$lib/server/medication-form";
import { createMedicationWithSchedules } from "$lib/server/medications";
import type { Actions } from "./$types";

export const actions: Actions = {
  default: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const form = parseMedicationForm(formData);
    if (!form.ok) return form.failure;

    // Single-transaction service: medication + schedules + audit
    // commit or roll back together, so a failed schedule insert
    // cannot leave an orphaned medication row.
    await createMedicationWithSchedules(locals.user!.id, form.medication, form.schedules);
    redirect(302, "/medications");
  },
};
