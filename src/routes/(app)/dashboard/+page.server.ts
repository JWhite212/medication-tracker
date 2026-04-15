import { fail } from "@sveltejs/kit";
import { getActiveMedications } from "$lib/server/medications";
import { getTodaysDoses, logDose, deleteDose } from "$lib/server/doses";
import { doseLogSchema } from "$lib/utils/validation";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user!;
  const [medications, doses] = await Promise.all([
    getActiveMedications(user.id),
    getTodaysDoses(user.id, user.timezone),
  ]);
  return { medications, doses, timezone: user.timezone };
};

export const actions: Actions = {
  logDose: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = doseLogSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors });
    }

    const { medicationId, quantity, takenAt, notes } = parsed.data;
    await logDose(
      locals.user!.id,
      medicationId,
      quantity,
      takenAt ? new Date(takenAt) : undefined,
      notes,
    );

    return { success: true };
  },
  deleteDose: async ({ request, locals }) => {
    const formData = await request.formData();
    const doseId = formData.get("doseId") as string;

    if (!doseId) return fail(400, { error: "Missing dose ID" });
    await deleteDose(locals.user!.id, doseId);
    return { success: true };
  },
};
