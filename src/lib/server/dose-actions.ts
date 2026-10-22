import { error, fail, type ActionFailure } from "@sveltejs/kit";
import { deleteDose, restoreDose, updateDose } from "$lib/server/doses";
import { doseDeleteSchema, doseEditSchema, doseRestoreSchema } from "$lib/utils/validation";
import { DOSE_UNDO_WINDOW_MS, RESTORE_GONE_MESSAGE } from "$lib/utils/dose-undo";
import { resolveEditedInstant } from "$lib/utils/time";

/**
 * Dose-write form actions that more than one route serves.
 *
 * The dashboard and /log both expose `?/deleteDose` and `?/editDose`, and
 * each used to spell the actions out for itself. They now share one body
 * each, so the 401 guard, the parse, D8's create-Undo flag, the restore
 * handle and the edited-time rules cannot drift apart between the two
 * routes. `restoreDoseAction`, a delete's Undo, lives here too, beside the
 * handle it consumes.
 */

/** Refusal shown beside the edit dialog's Time Taken field. */
export const FUTURE_TAKEN_AT_MESSAGE =
  "That time is in the future. Check the date as well as the time.";

/**
 * How far past the server's clock an edited time may sit. The field has
 * minute precision and is typed from the device's clock, so "now" on a phone
 * a little fast lands just ahead; five minutes covers that without letting a
 * wrong date through.
 */
export const EDITED_TAKEN_AT_GRACE_MS = 5 * 60_000;

/**
 * `?/editDose`, for the dashboard and /log.
 *
 * - **401 first**, for the same reason as `deleteDoseAction`.
 * - **No future times.** The Time Taken field keeps the dose's own date, so
 *   a dose logged just after midnight and changed to 23:45 to mean the night
 *   before names 23:45 *tonight*. That was accepted, filed under Today, sorted
 *   above everything and shown as "just now" until the day caught up. It is
 *   refused beside the field instead. An unchanged save of a dose already
 *   stored ahead is refused too, so the dialog says what to fix.
 * - **Gone** is a 404, never a success the toast would misreport.
 *
 * `/api/v1`'s `update_dose` is a separate door and is not covered here.
 */
export async function editDoseAction(event: {
  locals: App.Locals;
  request: Request;
}): Promise<
  ActionFailure<{ editErrors: Record<string, string[] | undefined> }> | { success: true }
> {
  const { locals, request } = event;
  if (!locals.user) error(401, "Unauthorized");
  const user = locals.user;

  const parsed = doseEditSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

  const { doseId, takenAt, originalTakenAt, quantity, notes, sideEffects } = parsed.data;
  const instant = resolveEditedInstant(takenAt, originalTakenAt, user.timezone);
  if (instant.getTime() > Date.now() + EDITED_TAKEN_AT_GRACE_MS) {
    return fail(400, { editErrors: { takenAt: [FUTURE_TAKEN_AT_MESSAGE] } });
  }

  const updated = await updateDose(user.id, doseId, {
    takenAt: instant,
    quantity,
    notes,
    sideEffects: sideEffects ?? null,
  });
  if (!updated) return fail(404, { editErrors: { form: ["Dose no longer exists"] } });
  return { success: true };
}

/**
 * `?/deleteDose`, for the dashboard and /log.
 *
 * - **401 first.** A request with no signed-in user is refused before
 *   anything else runs, because form actions execute before the `(app)`
 *   layout's guard.
 * - **Bad input.** A body that fails `doseDeleteSchema` keeps the old copy,
 *   "Missing dose ID". That includes a `forUndo` other than `"1"`: a
 *   malformed flag never falls through to a delete that keeps a trash row.
 * - **A create's Undo.** `forUndo=1` marks the delete behind a create's
 *   Undo. Nobody can undo that one, so it keeps no trash row and returns no
 *   `restore` (D8).
 * - **An ordinary delete** returns the handle its Undo posts back:
 *   `deletedAt`, exactly as stamped, and how long the server keeps the row.
 * - **Already gone.** A dose removed in another tab, by the Mac app or by a
 *   double tap gets a 404, never a success the toast would misreport.
 */
export async function deleteDoseAction(event: {
  locals: App.Locals;
  request: Request;
}): Promise<
  | ActionFailure<{ error: string }>
  | { success: true; doseId: string; restore?: { deletedAt: string; expiresInMs: number } }
> {
  const { locals, request } = event;
  if (!locals.user) error(401, "Unauthorized");
  const user = locals.user;

  const parsed = doseDeleteSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return fail(400, { error: "Missing dose ID" });

  const { doseId, forUndo } = parsed.data;
  const keepForUndo = forUndo !== "1";
  const deleted = await deleteDose(user.id, doseId, { keepForUndo });
  if (!deleted) return fail(404, { error: "Dose not found" });

  if (!keepForUndo) return { success: true, doseId };
  return {
    success: true,
    doseId,
    restore: { deletedAt: deleted.deletedAt.toISOString(), expiresInMs: DOSE_UNDO_WINDOW_MS },
  };
}

/**
 * 410: the Undo window has closed, or the dose is gone for good. Defined in
 * utils/dose-undo.ts, which the client reads too: an Undo pressed after its
 * offer's deadline says the same thing without asking.
 */
export { RESTORE_GONE_MESSAGE };

/** 409: a dose of this medication was logged after the delete (D6). */
export const RESTORE_LOGGED_SINCE_MESSAGE =
  "A newer entry exists for this medication, so Undo wasn't applied.";

/**
 * `?/restoreDose`, a delete's Undo. The client posts it to the absolute
 * `/dashboard?/restoreDose` from any page, including after navigating away.
 *
 * - **401 first**, for the same reason as `deleteDoseAction`.
 * - **The token** is the `restore.deletedAt` that `deleteDoseAction`
 *   returned, posted back as it was sent. A body that fails
 *   `doseRestoreSchema` restores nothing.
 * - **`already_restored` is success.** A retried Undo whose first attempt
 *   landed finds the dose already back, which is what the user asked for.
 * - **`gone`** (window closed, purged, wiped, medication deleted) is a 410.
 *   **`logged_since`** is a 409. `actionErrorMessage` reads either `error`
 *   string as it stands.
 */
export async function restoreDoseAction(event: {
  locals: App.Locals;
  request: Request;
}): Promise<ActionFailure<{ error: string }> | { success: true; doseId: string }> {
  const { locals, request } = event;
  if (!locals.user) error(401, "Unauthorized");
  const user = locals.user;

  const parsed = doseRestoreSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return fail(400, { error: "Invalid undo request" });

  const { doseId, deletedAt } = parsed.data;
  const outcome = await restoreDose(user.id, doseId, new Date(deletedAt));
  switch (outcome) {
    case "restored":
    case "already_restored":
      return { success: true, doseId };
    case "gone":
      return fail(410, { error: RESTORE_GONE_MESSAGE });
    case "logged_since":
      return fail(409, { error: RESTORE_LOGGED_SINCE_MESSAGE });
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unhandled restore outcome: ${String(unhandled)}`);
    }
  }
}
