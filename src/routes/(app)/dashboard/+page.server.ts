import { fail } from "@sveltejs/kit";
import { getActiveMedications } from "$lib/server/medications";
import {
  getTodaysDoses,
  logDose,
  deleteDose,
  updateDose,
  getLastDosePerMedication,
} from "$lib/server/doses";
import { doseLogSchema, doseEditSchema } from "$lib/utils/validation";
import { parseDateTimeLocal, computeTimingStatus } from "$lib/utils/time";
import type { Actions, PageServerLoad } from "./$types";
import type { MedicationTimingStatus } from "$lib/types";

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user!;
  const [medications, doses, lastDoses] = await Promise.all([
    getActiveMedications(user.id),
    getTodaysDoses(user.id, user.timezone),
    getLastDosePerMedication(user.id),
  ]);

  const lastDoseMap = new Map(
    lastDoses.map((d) => [d.medicationId, d.lastTakenAt]),
  );

  const now = new Date();
  const timingStatus: MedicationTimingStatus[] = medications
    .filter(
      (m) =>
        m.scheduleType === "scheduled" &&
        m.scheduleIntervalHours !== null &&
        m.scheduleIntervalHours !== undefined,
    )
    .map((m) => {
      const lastTakenAt = lastDoseMap.get(m.id) ?? null;
      const { status, minutesUntilDue } = computeTimingStatus(
        Number(m.scheduleIntervalHours),
        lastTakenAt,
        now,
      );
      return { medicationId: m.id, status, minutesUntilDue, lastTakenAt };
    });

  return { medications, doses, timezone: user.timezone, timingStatus };
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
  editDose: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = doseEditSchema.safeParse(formData);
    if (!parsed.success)
      return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

    const { doseId, takenAt, quantity, notes } = parsed.data;
    await updateDose(locals.user!.id, doseId, {
      takenAt: parseDateTimeLocal(takenAt, locals.user!.timezone),
      quantity,
      notes,
    });
    return { success: true };
  },
};
