import { error, fail } from "@sveltejs/kit";
import { track } from "@vercel/analytics/server";
import { getRefillForecast } from "$lib/server/inventory";
import { loadDashboard } from "$lib/server/dashboard/load";
import {
  logDose,
  logDoseForSlot,
  logDoseAtSlot,
  logSkippedDose,
  skipDoseForSlot,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} from "$lib/server/doses";
import { deleteDoseAction, editDoseAction, restoreDoseAction } from "$lib/server/dose-actions";
import { doseLogSchema, doseSkipSchema } from "$lib/utils/validation";
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
        // "Took it at HH:MM": the slot's own instant. `logDoseAtSlot` locks
        // the medication, re-derives this row's buttons and writes ×1 only if
        // the row still offers Took it at this instant. So a double tap, a
        // second device's stale page or a skip-resolved slot is told to
        // refresh. The posted `quantity` is not read (spec D9).
        const row = await logDoseAtSlot(
          user.id,
          medicationId,
          at,
          notes,
          sideEffects,
          now,
          user.timezone,
        );
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
  // Shared with /log. The 401 guard, the parse, D8's `forUndo` and the
  // restore handle all live in `deleteDoseAction`.
  deleteDose: (event) => deleteDoseAction(event),
  // A delete's Undo. Every page posts it to the absolute
  // `/dashboard?/restoreDose`, so it still works after navigating away.
  restoreDose: (event) => restoreDoseAction(event),
  editDose: (event) => editDoseAction(event),
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

    const { medicationId, takenAt, forSlot } = parsed.data;
    const now = new Date();

    let doseId: string;
    try {
      if (forSlot) {
        // The row's own Skip. `skipDoseForSlot` locks the medication,
        // re-derives the row's buttons and writes the skip at the SERVER's
        // `min(slot, now)`. There is no `checkSlotActionTime` here: a due-now
        // slot is legitimately still ahead, and a row that is resolved or off
        // the dashboard is simply not offered.
        doseId = await skipDoseForSlot(
          user.id,
          medicationId,
          new Date(forSlot),
          now,
          user.timezone,
        );
      } else if (takenAt) {
        // legacy pre-deploy page; see spec D9; delete one release after.
        // That page posted the row's `skipAt`, which is the slot's own
        // instant exactly when the slot is past. So checking it as the slot
        // accepts every past-slot Skip and refuses the rest with a 409.
        doseId = await skipDoseForSlot(
          user.id,
          medicationId,
          new Date(takenAt),
          now,
          user.timezone,
        );
      } else {
        // The legacy skip-at-now.
        doseId = await logSkippedDose(user.id, medicationId);
      }
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
