import { fail } from "@sveltejs/kit";
import { getActiveMedications } from "$lib/server/medications";
import { getRefillForecast } from "$lib/server/inventory";
import {
  getTodaysDoses,
  getLastDosePerMedication,
  logDose,
  logSkippedDose,
  deleteDose,
  updateDose,
  MedicationNotFoundError,
} from "$lib/server/doses";
import { doseLogSchema, doseEditSchema } from "$lib/utils/validation";
import { parseDateTimeLocal, startOfDay, computeTimingStatus } from "$lib/utils/time";
import { computeScheduleSlots } from "$lib/utils/schedule";
import { getSchedulesForUser } from "$lib/server/schedules";
import type { Actions, PageServerLoad } from "./$types";
import type { MedicationTimingStatus } from "$lib/types";

export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user!;
  const [medications, doses, lastDoses, schedulesByMedId, refillForecast] = await Promise.all([
    getActiveMedications(user.id),
    getTodaysDoses(user.id, user.timezone),
    getLastDosePerMedication(user.id),
    getSchedulesForUser(user.id),
    getRefillForecast(user.id),
  ]);

  // lastEventAt advances on both "taken" and "skipped" so a Skip clears
  // the overdue badge; lastTakenAt anchors slot projection so historical
  // taken doses stay visible on My Day.
  const lastEventMap = new Map(lastDoses.map((d) => [d.medicationId, d.lastEventAt]));

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
      const lastEventAt = lastEventMap.get(m.id) ?? null;
      const { status, minutesUntilDue } = computeTimingStatus(
        Number(m.scheduleIntervalHours),
        lastEventAt,
        now,
      );
      return { medicationId: m.id, status, minutesUntilDue };
    });

  // Schedule slots for My Day timeline — anchor from last *taken* dose
  // so the day's already-taken slots stay in the projection.
  const lastDoseByMedication: Record<string, Date> = {};
  for (const d of lastDoses) {
    if (d.lastTakenAt) lastDoseByMedication[d.medicationId] = d.lastTakenAt;
  }

  const dayStart = startOfDay(now, user.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const scheduleSlots = computeScheduleSlots(
    medications,
    schedulesByMedId,
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
    refillForecast,
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
    try {
      await logDose(
        locals.user!.id,
        medicationId,
        quantity,
        takenAt ? new Date(takenAt) : undefined,
        notes,
        sideEffects,
      );
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { errors: { form: ["Medication not found"] } });
      }
      throw err;
    }

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
    if (!parsed.success) return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

    const { doseId, takenAt, quantity, notes, sideEffects } = parsed.data;
    await updateDose(locals.user!.id, doseId, {
      takenAt: parseDateTimeLocal(takenAt, locals.user!.timezone),
      quantity,
      notes,
      sideEffects: sideEffects ?? null,
    });
    return { success: true };
  },
  skipDose: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const medicationId = String(formData.medicationId);
    if (!medicationId) return fail(400);
    try {
      await logSkippedDose(locals.user!.id, medicationId);
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { error: "Medication not found" });
      }
      throw err;
    }
    return { success: true };
  },
};
