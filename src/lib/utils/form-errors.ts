import type { ActionResult } from "@sveltejs/kit";

/**
 * The user-facing message for a failed form action.
 *
 * The `(app)` actions return four different failure shapes, all of them
 * reasonable in isolation and none of them the same:
 *
 *   fail(400, { errors: { field: [...] } })      zod field errors
 *   fail(404, { errors: { form: ["..."] } })     a form-level message
 *   fail(404, { error: "Dose not found" })       a bare string
 *   fail(400)                                    no body at all
 *
 * plus `result.type === "error"`, which is an unexpected throw and carries
 * `App.Error` — the safe message and correlation id `handleError` minted.
 *
 * Every call site that wanted to show a failure therefore had to know all
 * five, which is a large part of why three of them showed nothing at all and
 * simply dropped the failure on the floor. One reader, one fallback.
 *
 * Deliberately NOT a component: the dashboard, the timeline and the
 * medications list each render their own toast, and this is the string, not
 * the presentation.
 */
export function actionErrorMessage(
  result: ActionResult,
  fallback = "Something went wrong — please try again.",
): string {
  if (result.type === "error") {
    // `handleError` already made this safe to render, and attached the
    // reference the user can quote.
    const error = result.error as App.Error | undefined;
    const message = error?.message ?? fallback;
    return error?.errorId ? `${message} (reference ${error.errorId})` : message;
  }

  if (result.type !== "failure") return fallback;

  const data = result.data as
    | { error?: unknown; errors?: Record<string, unknown> | undefined }
    | undefined;
  if (!data) return fallback;

  if (typeof data.error === "string" && data.error.length > 0) return data.error;

  // Prefer the form-level message; fall back to whichever field spoke first,
  // so a validation failure says something specific rather than "went wrong".
  const errors = data.errors;
  if (errors && typeof errors === "object") {
    const form = firstString(errors.form);
    if (form) return form;

    for (const value of Object.values(errors)) {
      const message = firstString(value);
      if (message) return message;
    }
  }

  return fallback;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (!Array.isArray(value)) return undefined;
  return value.find((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
