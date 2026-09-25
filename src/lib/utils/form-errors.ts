import type { ActionResult } from "@sveltejs/kit";

/**
 * The user-facing message for a failed form action.
 *
 * The `(app)` actions return five different failure shapes, all of them
 * reasonable in isolation and none of them the same:
 *
 *   fail(400, { errors: { field: [...] } })      zod field errors
 *   fail(404, { errors: { form: ["..."] } })     a form-level message
 *   fail(400, { editErrors: { ... } })           either of those, under the
 *                                                dose-edit action's own key
 *   fail(404, { error: "Dose not found" })       a bare string
 *   fail(400)                                    no body at all
 *
 * plus `result.type === "error"`, which is an unexpected throw and carries
 * `App.Error` — the safe message and correlation id `handleError` minted.
 *
 * Every call site that wanted to show a failure therefore had to know all
 * six, which is a large part of why three of them showed nothing at all and
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

  const data = result.data as { error?: unknown } | undefined;
  if (!data) return fallback;

  if (typeof data.error === "string" && data.error.length > 0) return data.error;

  // Prefer the form-level message; fall back to whichever field spoke first,
  // so a validation failure says something specific rather than "went wrong".
  const bags = errorBags(result);
  for (const bag of bags) {
    const form = firstString(bag.form);
    if (form) return form;
  }
  for (const bag of bags) {
    for (const value of Object.values(bag)) {
      const message = firstString(value);
      if (message) return message;
    }
  }

  return fallback;
}

export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired, so this was not saved. Sign in again in another tab, then save.";

export const NO_RESPONSE_MESSAGE =
  "Couldn't reach the server, so this was not saved. Check your connection and try again.";

/**
 * The message for a failed save that the form answers in place, keeping the
 * user's input on screen instead of handing the result to +error.svelte.
 *
 * Two error results reach such a form carrying text that is true and of no
 * use. An expired session is the `(app)` actions' `error(401,
 * "Unauthorized")`, which does not say what to do, and the obvious recovery
 * (signing in on this page) would throw the edit away. A request that never
 * got an answer is whatever `enhance` caught: the `TypeError` from `fetch`,
 * or the `SyntaxError` from a body that was not an action result. It has no
 * `status`, because there was no response to read one from, and its message
 * is the browser's ("Failed to fetch", "Load failed"). Both are said here
 * for what they mean to the user: nothing was saved, and what to do next.
 *
 * Everything else, a crash's reference included, is `actionErrorMessage`'s,
 * so this refines that reader rather than becoming a second one. It is a
 * separate function because the other callers answer with a toast after a
 * one-click action, where there is no edit to protect and the advice to sign
 * in elsewhere would be odd.
 */
export function unsavedErrorMessage(result: ActionResult, fallback?: string): string {
  if (result.type === "error") {
    if (result.status === 401) return SESSION_EXPIRED_MESSAGE;
    if (result.status === undefined) return NO_RESPONSE_MESSAGE;
  }
  return actionErrorMessage(result, fallback);
}

/**
 * Every keyed message of a failed form action, the first one per field.
 *
 * `actionErrorMessage` answers "what went wrong" in one string, which suits
 * a toast and does not suit a form that can put each message beside the
 * control it is about: that needs all of them, keyed by field name, and it
 * needs them from this module so the call site still never opens
 * `result.data` itself.
 *
 * Every key is returned, `form` included. On most actions `form` is the
 * form-level message, but on the medication form it is the dosage-form
 * field, so filtering it here would lose a real field's message; a caller
 * with no control of that name simply does not render it.
 *
 * Anything other than a failure returns an empty object rather than
 * undefined, so a caller can assign the result straight into state and a
 * later success or crash clears the previous attempt's messages.
 */
export function actionFieldErrors(result: ActionResult): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const bag of errorBags(result)) {
    for (const [field, value] of Object.entries(bag)) {
      if (field in fields) continue;
      const message = firstString(value);
      if (message) fields[field] = message;
    }
  }
  return fields;
}

/**
 * The `aria-describedby` value for a control: the ids of the messages that
 * are actually rendered, space-separated.
 *
 * The forms use it the same way throughout. A field is described by its own
 * keyed error and by the form-level message, if either is showing, but only
 * its own error makes it `aria-invalid`: a form-level message can be a
 * refusal ("Too many attempts", an expired reset link) about a value that is
 * perfectly fine, and only a keyed error is the server saying which value
 * was wrong. The one exception is a page with a single field (`/auth/2fa`,
 * `/auth/reset-password`), where an unkeyed message with a 400 status can be
 * about nothing else.
 *
 * Each id is passed guarded by the same condition that renders its element,
 * so the attribute can never name a message that is not on the page, and an
 * empty result is `undefined`, which Svelte omits, rather than `""`, which
 * it would emit as an attribute pointing at nothing.
 */
export function ariaDescribedBy(
  ...ids: Array<string | false | null | undefined>
): string | undefined {
  const present = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
  return present.length > 0 ? present.join(" ") : undefined;
}

/**
 * Where a failure keeps its keyed messages. `errors` is the common case;
 * `editErrors` is the same shape under the name the `/log` and `/dashboard`
 * `editDose` actions give it. Listed rather than guessed from a suffix, so a
 * new name is a deliberate addition here and not something the reader
 * stumbles into.
 */
const ERROR_BAGS = ["errors", "editErrors"] as const;

function errorBags(result: ActionResult): Array<Record<string, unknown>> {
  if (result.type !== "failure" || !result.data) return [];
  const data = result.data as Record<string, unknown>;
  return ERROR_BAGS.map((key) => data[key]).filter(
    (bag): bag is Record<string, unknown> => !!bag && typeof bag === "object",
  );
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (!Array.isArray(value)) return undefined;
  return value.find((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
