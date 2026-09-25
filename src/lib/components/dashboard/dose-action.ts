/**
 * Endpoints and copy DoseActionForm owns, separate from the component so tests
 * import them without rendering it.
 */

/**
 * Absolute, not `?/deleteDose`: the Toast is mounted once in the (app) layout
 * and outlives navigation, so a relative action would post to whichever page
 * the user has moved to.
 */
export const UNDO_ACTION = "/dashboard?/deleteDose";

/** The client-side stale guard: the payload expired before the tap. The server check on Log now is the authority. */
export const STALE_TAP_MESSAGE = "The list just updated — check it and tap again";

/** The success toast when the caller supplied no builder, or its builder had nothing to say. */
export const SUCCESS_FALLBACK_TOAST = "Saved";

/** After the toast's Undo removed the dose. */
export const UNDONE_TOAST = "Undone";

/**
 * A dose write whose outcome is unknown because the request never completed.
 * It may have landed, and a chip retry would log a second dose, so the user
 * is sent to Done first.
 */
export const NETWORK_FAILURE_TOAST = "Couldn't reach the server. Check Done before trying again.";
