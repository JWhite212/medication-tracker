import { fail } from "@sveltejs/kit";
import { getActiveMedications } from "$lib/server/medications";
import {
  getTodaysDoses,
  getLastDosePerMedication,
  logDose,
  deleteDose,
  updateDose,
} from "$lib/server/doses";
import { doseLogSchema, doseEditSchema } from "$lib/utils/validation";
import {
  parseDateTimeLocal,
  startOfDay,
  computeTimingStatus,
} from "$lib/utils/time";
import { computeScheduleSlots } from "$lib/utils/schedule";
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

  // Timing status for QuickLogBar badges
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

  // Schedule slots for My Day timeline
  const lastDoseByMedication: Record<string, Date> = {};
  for (const d of lastDoses) {
    lastDoseByMedication[d.medicationId] = d.lastTakenAt;
  }

  const dayStart = startOfDay(now, user.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const scheduleSlots = computeScheduleSlots(
    medications,
    doses,
    lastDoseByMedication,
    dayStart,
    dayEnd,
    user.timezone,
    now,
  );

  return {
    medications,
    doses,
    scheduleSlots,
    timezone: user.timezone,
    timingStatus,
  };
};

export const actions: Actions = {
  logDose: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = doseLogSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors });
    }

    const { medicationId, quantity, takenAt, notes, sideEffects } = parsed.data;
    await logDose(
      locals.user!.id,
      medicationId,
      quantity,
      takenAt ? new Date(takenAt) : undefined,
      notes,
      sideEffects,
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

    const { doseId, takenAt, quantity, notes, sideEffects } = parsed.data;
    await updateDose(locals.user!.id, doseId, {
      takenAt: parseDateTimeLocal(takenAt, locals.user!.timezone),
      quantity,
      notes,
      sideEffects: sideEffects ?? null,
    });
    return { success: true };
  },
};
