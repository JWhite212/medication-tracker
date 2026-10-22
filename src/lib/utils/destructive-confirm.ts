/**
 * What a permanent deletion takes with it, in words.
 *
 * The four deletions nothing can undo (Privacy's two wipes, Data's account
 * deletion and Import's replace mode) share one confirmation dialog, and that
 * dialog states what will go using the server's counts. The sentences are
 * decided here, once, so the dialog and a page's "nothing to delete" line
 * cannot disagree.
 *
 * NO imports, on purpose: `ui/DestructiveConfirm.svelte` and the three pages
 * are client code, and the server guard reads `DestructiveWord` from here too.
 * Counts use en-GB grouping, matching `formatUserDate`'s default; a bare
 * `toLocaleString()` would vary with the viewer's browser.
 */

/** The word typed to confirm. Exact, case-sensitive, trimmed. */
export type DestructiveWord = "DELETE" | "REPLACE";

/**
 * How recently an account with no password must have signed in before any
 * of the four deletions runs. `signedInRecently` in the server guard is the
 * one place it is compared against.
 */
export const RECENT_SIGN_IN_WINDOW_MS = 10 * 60 * 1000;

/**
 * The guard's refusal when that sign-in is too old, and the title of the
 * prompt that offers a fresh one. The dialog recognises the refusal by this
 * exact string (as Toast does `RESTORE_GONE_MESSAGE`), so the failure keeps
 * the plain `{ error }` shape `actionErrorMessage` reads.
 */
export const RECENT_SIGN_IN_MESSAGE = "Sign in again to confirm.";

/** The providers a browser can sign in again with. Apple exists only on `/api/v1`. */
export type WebProvider = "google" | "github";

/**
 * The only pages "Sign in again" may send the user back to: the three that
 * host one of the four deletions. Matched EXACTLY — no prefix, query,
 * fragment, trailing slash or decoding — because the candidate arrives in a
 * query string and is then held in a cookie the user can edit, and any looser
 * match is an open redirect.
 */
export const RETURN_PATHS = [
  "/settings/privacy",
  "/settings/data",
  "/settings/data/import",
] as const;
export type ReturnPath = (typeof RETURN_PATHS)[number];

export function returnPathOrNull(candidate: string | null | undefined): ReturnPath | null {
  return (RETURN_PATHS as readonly string[]).includes(candidate ?? "")
    ? (candidate as ReturnPath)
    : null;
}

/**
 * What a deletion's dialog asks for, decided on the server by the guard's
 * own rules (`destructiveConfirmation`): a password, or (for an account with
 * none) the word and a recent sign-in, which `recent` says the session has
 * and `providers` say how to refresh.
 */
export type DestructiveConfirmation =
  | { kind: "password" }
  | { kind: "recentSignIn"; recent: boolean; providers: WebProvider[] };

/** The OAuth start leg, told where to come back to. */
export function signInAgainHref(provider: WebProvider, returnTo: ReturnPath): string {
  return `/auth/callback/${provider}?returnTo=${encodeURIComponent(returnTo)}`;
}

const NUMBER = new Intl.NumberFormat("en-GB");

/** A count with en-GB thousands grouping, whatever the runtime's locale. */
export function formatCount(n: number): string {
  return NUMBER.format(n);
}

function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function doseHistorySummary(c: { doses: number; medications: number }): string {
  if (c.doses === 0) return "There is no dose history to delete.";
  return `This deletes ${plural(c.doses, "dose", "doses")} for ${plural(c.medications, "medication", "medications")}.`;
}

export function archivedMedicationsSummary(c: { medications: number; doses: number }): string {
  if (c.medications === 0) return "There are no archived medications to delete.";
  const meds = plural(c.medications, "archived medication", "archived medications");
  const them = c.medications === 1 ? "it" : "them";
  if (c.doses === 0) return `This deletes ${meds}. No doses were logged for ${them}.`;
  return `This deletes ${meds} and the ${plural(c.doses, "dose", "doses")} logged for ${them}.`;
}

export function accountDeletionSummary(c: { medications: number; doses: number }): string {
  return `This deletes your account and settings, ${plural(c.medications, "medication", "medications")} and ${plural(c.doses, "dose", "doses")}.`;
}

export function replaceSummary(c: { medications: number; doses: number }): string {
  if (c.medications === 0) {
    return "Your account has no medications, so nothing is deleted before the file is imported.";
  }
  return `This deletes ${plural(c.medications, "medication", "medications")} and ${plural(c.doses, "dose", "doses")}, with their schedules and inventory history, then imports the file.`;
}
