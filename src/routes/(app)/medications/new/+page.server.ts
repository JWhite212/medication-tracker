import { fail, redirect } from "@sveltejs/kit";
import { medicationSchema } from "$lib/utils/validation";
import { createMedication } from "$lib/server/medications";
import type { Actions } from "./$types";

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

    await createMedication(locals.user!.id, parsed.data);
    redirect(302, "/medications");
  },
};
