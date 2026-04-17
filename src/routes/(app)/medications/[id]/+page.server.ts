import { fail, redirect, error } from "@sveltejs/kit";
import { medicationSchema } from "$lib/utils/validation";
import {
  getMedicationById,
  updateMedication,
  archiveMedication,
  unarchiveMedication,
} from "$lib/server/medications";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const medication = await getMedicationById(locals.user!.id, params.id);
  if (!medication) error(404, "Medication not found");
  return { medication };
};

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = medicationSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        values: formData,
      });
    }

    const result = await updateMedication(
      locals.user!.id,
      params.id,
      parsed.data,
    );
    if (!result) error(404, "Medication not found");
    redirect(302, "/medications");
  },
  archive: async ({ locals, params }) => {
    await archiveMedication(locals.user!.id, params.id);
    redirect(302, "/medications");
  },
  unarchive: async ({ locals, params }) => {
    await unarchiveMedication(locals.user!.id, params.id);
    redirect(302, "/medications");
  },
};
