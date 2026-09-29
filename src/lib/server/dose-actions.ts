import { error, fail, type ActionFailure } from "@sveltejs/kit";
import { deleteDose } from "$lib/server/doses";
import { doseDeleteSchema } from "$lib/utils/validation";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";

/**
 * Dose-write form actions that more than one route serves.
 *
 * The dashboard and /log both expose `?/deleteDose`, and each used to spell
 * the action out for itself. They now share one body, so the 401 guard, the
 * parse, D8's create-Undo flag and the restore handle cannot drift apart
 * between the two routes. (Task 3 adds `restoreDoseAction` here.)
 */

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
