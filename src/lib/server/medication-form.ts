import { fail } from "@sveltejs/kit";
import { medicationSchema, schedulesSchema } from "$lib/utils/validation";

/**
 * The medication form's one reader, shared by `medications/new` (create) and
 * `medications/[id]` (`?/update`). Both doors used to carry byte-identical
 * copies of this, failure strings included, so a fix to one could silently
 * miss the other. `tests/unit/medication-form.test.ts` scans `src/` and
 * fails if either route grows its own copy again.
 */

export const INVALID_SCHEDULES_MESSAGE = "Add at least one valid schedule row";

/**
 * The form posts its schedule rows as one JSON string. Anything that is not a
 * non-empty string, or does not parse, becomes `undefined`, which
 * `schedulesSchema` then rejects.
 */
export function parseSchedules(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Validate a posted medication form. The medication fields are checked first,
 * and only a valid medication has its schedules checked, so a form wrong in
 * both places reports the field errors. On failure, `failure` is the
 * `fail(400, …)` the action returns as-is; it echoes the posted `values` so
 * the form re-renders with what the user typed.
 */
export function parseMedicationForm(formData: Record<string, FormDataEntryValue>) {
  const parsed = medicationSchema.safeParse(formData);
  if (!parsed.success) {
    return {
      ok: false as const,
      failure: fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        values: formData,
      }),
    };
  }

  const schedulesParsed = schedulesSchema.safeParse(parseSchedules(formData.schedules));
  if (!schedulesParsed.success) {
    return {
      ok: false as const,
      failure: fail(400, {
        errors: { schedules: [INVALID_SCHEDULES_MESSAGE] },
        values: formData,
      }),
    };
  }

  return { ok: true as const, medication: parsed.data, schedules: schedulesParsed.data };
}
