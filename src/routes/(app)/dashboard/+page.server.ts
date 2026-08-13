import { fail } from "@sveltejs/kit";
import { track } from "@vercel/analytics/server";
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
import { parseDateTimeLocal, startOfDay } from "$lib/utils/time";
import { outstandingSlots, timingStatusFromSlots } from "$lib/utils/due";
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

  const now = new Date();
  const dayStart = startOfDay(now, user.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Phase anchor: the last event that RESOLVED a slot — taken or skipped —
  // which may predate today. Kept separate from `doses` (today's rows), the
  // only thing a slot may be matched against, so a dose from before the
  // window can phase the projection without being paired to a slot inside it.
  const anchorByMedication = new Map<string, Date>();
  for (const d of lastDoses) {
    if (d.lastEventAt) anchorByMedication.set(d.medicationId, d.lastEventAt);
  }

  const scheduleSlots = outstandingSlots(
    medications,
    schedulesByMedId,
    { kind: "events", doses, anchorByMedication },
    { startUtc: dayStart, endUtc: dayEnd },
    user.timezone,
    now,
  );

  // Every medication's badge is derived from the same slots the timeline
  // renders. There is no second implementation and no covered-set merge:
  // one module answers "is this due?" for both surfaces.
  const timingStatus: MedicationTimingStatus[] = [];
  for (const med of medications) {
    const t = timingStatusFromSlots(
      scheduleSlots.filter((s) => s.medicationId === med.id),
      now,
    );
    if (t) timingStatus.push({ medicationId: med.id, ...t });
  }

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

    // Fire-and-forget product analytics. Only safe, non-PII metadata is sent:
    // no medication id/name, no notes content, no side-effect strings.
    try {
      await track("dose_logged", {
        source: "dashboard",
        hasNotes: Boolean(notes),
        hasSideEffects: Array.isArray(sideEffects) && sideEffects.length > 0,
      });
    } catch {
      // Telemetry failure must never break the user's dose log.
    }

    return { success: true };
  },
  deleteDose: async ({ request, locals }) => {
    const formData = await request.formData();
    const doseId = formData.get("doseId") as string;

    if (!doseId) return fail(400, { error: "Missing dose ID" });
    // deleteDose returns false for a stale/unowned row (removed in
    // another tab or via sync) — surface it instead of a false toast.
    const deleted = await deleteDose(locals.user!.id, doseId);
    if (!deleted) return fail(404, { error: "Dose not found" });
    return { success: true };
  },
  editDose: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = doseEditSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

    const { doseId, takenAt, quantity, notes, sideEffects } = parsed.data;
    const updated = await updateDose(locals.user!.id, doseId, {
      takenAt: parseDateTimeLocal(takenAt, locals.user!.timezone),
      quantity,
      notes,
      sideEffects: sideEffects ?? null,
    });
    if (!updated) return fail(404, { editErrors: { form: ["Dose no longer exists"] } });
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
