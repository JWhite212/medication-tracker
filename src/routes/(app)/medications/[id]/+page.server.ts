import { fail, redirect, error } from "@sveltejs/kit";
import { medicationSchema, schedulesSchema } from "$lib/utils/validation";
import {
  getMedicationById,
  updateMedication,
  archiveMedication,
  unarchiveMedication,
} from "$lib/server/medications";
import { getSchedulesForMedication, replaceSchedulesForMedication } from "$lib/server/schedules";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const userId = locals.user!.id;
  const medication = await getMedicationById(userId, params.id);
  if (!medication) error(404, "Medication not found");
  const schedules = await getSchedulesForMedication(params.id, userId);
  return { medication, schedules };
};

function parseSchedules(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

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

    const schedulesParsed = schedulesSchema.safeParse(parseSchedules(formData.schedules));
    if (!schedulesParsed.success) {
      return fail(400, {
        errors: { schedules: ["Add at least one valid schedule row"] },
        values: formData,
      });
    }

    const result = await updateMedication(locals.user!.id, params.id, parsed.data);
    if (!result) error(404, "Medication not found");
    await replaceSchedulesForMedication(params.id, locals.user!.id, schedulesParsed.data);
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
