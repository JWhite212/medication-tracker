import { error, fail } from "@sveltejs/kit";
import { track } from "@vercel/analytics/server";
import { getRefillForecast } from "$lib/server/inventory";
import { loadDashboard } from "$lib/server/dashboard/load";
import {
  logDose,
  logDoseForSlot,
  logSkippedDose,
  deleteDose,
  updateDose,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} from "$lib/server/doses";
import { doseLogSchema, doseEditSchema, doseSkipSchema } from "$lib/utils/validation";
import { resolveEditedInstant } from "$lib/utils/time";
import { checkSlotActionTime, type SlotActionTimeProblem } from "$lib/utils/schedule";
import type { DashboardPageData } from "$lib/types";
import type { Actions, PageServerLoad } from "./$types";

/**
 * I/O only. `loadDashboard` owns the window, the four dashboard queries and
 * the composition (`server/dashboard/`), `getRefillForecast` owns refills, and
 * this merges them. Two things are gone: the per-medication `timingStatus`
 * built on the deprecated interval columns, and the `covered` merge that
 * patched it for fixed-time medications. Every due-ness answer on this page
 * now comes from the per-slot model. New derived values belong in
 * `page-data.ts`, not here.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user!;
  // One instant per request: the window, every row's state and nextRefreshAt
  // are all computed against it.
  const now = new Date();
  const [dash, refillForecast] = await Promise.all([
    loadDashboard(user.id, user.timezone, now),
    getRefillForecast(user.id),
  ]);
  return { ...dash, refillForecast } satisfies DashboardPageData;
};

// The refusals a dashboard dose write can meet. Each is a shape
// `actionErrorMessage` already reads (`errors.form` / `errors.takenAt`), so
// the client needs no new branch. 409 means "your page is stale": the client
// re-runs the load before it lets the user try again.
const TAKEN_AT_IN_FUTURE = "That time hasn't happened yet.";
const SLOT_OFF_DASHBOARD = "This dose has moved off your dashboard. Refresh to see what's due now.";
const SLOT_TARGET_CHANGED = "What's due has changed. Refresh to see what's due now.";
const SLOT_ALREADY_TAKEN = "This dose is already logged as taken. Refresh to see it.";

function slotTimeFailure(problem: SlotActionTimeProblem) {
  return problem === "future"
    ? fail(400, { errors: { takenAt: [TAKEN_AT_IN_FUTURE] } })
    : fail(409, { errors: { form: [SLOT_OFF_DASHBOARD] } });
}

export const actions: Actions = {
  logDose: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");
    const user = locals.user;

    const formData = Object.fromEntries(await request.formData());
    const parsed = doseLogSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors });
    }

    const { medicationId, quantity, takenAt, forSlot, notes, sideEffects } = parsed.data;
    // One clock for the whole request: the stale check below and Log now's
    // recompute must judge the same instant.
    const now = new Date();
    const at = takenAt ? new Date(takenAt) : undefined;

    if (at) {
      const problem = checkSlotActionTime(at, now, user.timezone);
      if (problem) return slotTimeFailure(problem);
    }

    let doseId: string;
    try {
      if (forSlot) {
        // Log now. `quantity` is not read: the server proves where ONE dose
        // logged now lands, and it refuses (409) unless that is still the row
        // the button sat on.
        const row = await logDoseForSlot(
          user.id,
          medicationId,
          new Date(forSlot),
          now,
          user.timezone,
        );
        doseId = row.id;
      } else if (at) {
        // "Took it at HH:MM": the slot's own instant. The guard refuses an
        // instant that already holds a taken dose, so a double tap is one row
        // and one decrement, and a stale page is told to refresh.
        const row = await logDose(user.id, medicationId, quantity, at, notes, sideEffects, {
          exactInstantGuard: true,
        });
        doseId = row.id;
      } else {
        // A chip: logged now, exactly as before this page had slots.
        const row = await logDose(user.id, medicationId, quantity, undefined, notes, sideEffects);
        doseId = row.id;
      }
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { errors: { form: ["Medication not found"] } });
      }
      if (err instanceof SlotTargetChangedError) {
        return fail(409, { errors: { form: [SLOT_TARGET_CHANGED] } });
      }
      if (err instanceof SlotAlreadyTakenError) {
        return fail(409, { errors: { form: [SLOT_ALREADY_TAKEN] } });
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

    return { success: true, doseId };
  },
  deleteDose: async ({ request, locals }) => {
    if (!locals.user) error(401, "Unauthorized");

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
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const parsed = doseEditSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

    const { doseId, takenAt, originalTakenAt, quantity, notes, sideEffects } = parsed.data;
    const updated = await updateDose(locals.user!.id, doseId, {
      takenAt: resolveEditedInstant(takenAt, originalTakenAt, locals.user!.timezone),
      quantity,
      notes,
      sideEffects: sideEffects ?? null,
    });
    if (!updated) return fail(404, { editErrors: { form: ["Dose no longer exists"] } });
    return { success: true };
  },
  skipDose: async ({ request, locals }) => {
    if (!locals.user) error(401, "Unauthorized");
    const user = locals.user;

    const formData = Object.fromEntries(await request.formData());
    // Through the schema, not `String(formData.medicationId)`: that turned a
    // missing field into the id "undefined" and answered 404 where a
    // malformed request deserves 400.
    const parsed = doseSkipSchema.safeParse(formData);
    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors });
    }

    const { medicationId, takenAt } = parsed.data;
    const now = new Date();
    const at = takenAt ? new Date(takenAt) : undefined;

    if (at) {
      const problem = checkSlotActionTime(at, now, user.timezone);
      if (problem) return slotTimeFailure(problem);
    }

    let doseId: string;
    try {
      // With an instant, this is the row's own Skip (its `skipAt`), so it is
      // refused over a taken dose or an existing skip at that instant.
      // Without one it is the legacy skip-at-now.
      doseId = at
        ? await logSkippedDose(user.id, medicationId, at, { exactInstantGuard: true })
        : await logSkippedDose(user.id, medicationId);
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { error: "Medication not found" });
      }
      if (err instanceof SlotAlreadyTakenError) {
        return fail(409, { errors: { form: [SLOT_ALREADY_TAKEN] } });
      }
      if (err instanceof SlotTargetChangedError) {
        return fail(409, { errors: { form: [SLOT_TARGET_CHANGED] } });
      }
      throw err;
    }
    return { success: true, doseId };
  },
};
