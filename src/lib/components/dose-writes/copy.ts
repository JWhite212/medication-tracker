/**
 * Endpoints and copy for every dose write, on every page. Plain constants, so
 * a test imports them without rendering anything.
 */

/**
 * Absolute, not `?/deleteDose`: the toast that offers an Undo lives in the
 * (app) layout and outlives navigation, so a relative action would post to
 * whichever page the user has moved to.
 */
export const DELETE_ACTION = "/dashboard?/deleteDose";

/** Absolute for the same reason as DELETE_ACTION: a delete's Undo can be pressed from any page. */
export const RESTORE_ACTION = "/dashboard?/restoreDose";

/** The client-side stale guard: the payload expired before the tap. The server's own check is the authority. */
export const STALE_TAP_MESSAGE = "The list just updated — check it and tap again";

/** The success toast when the caller supplied no builder, or its builder had nothing to say. */
export const SUCCESS_FALLBACK_TOAST = "Saved";

/** After a create's Undo removed the dose. */
export const UNDONE_TOAST = "Undone";

/** After a delete's Undo put the dose back. */
export const RESTORED_TOAST = "Dose restored";

/** A write refused before it was sent, because the device is offline. Nothing was posted. */
export const OFFLINE_WRITE_TOAST = "You're offline — nothing was saved.";

/**
 * A write whose request never completed, so it may or may not have landed.
 * The page reloads itself once the server answers again, and dose controls
 * stay locked until it has: a retry against data nobody has checked is how a
 * duplicate dose happens.
 */
export const UNKNOWN_OUTCOME_TOAST =
  "Couldn't confirm that saved — this page will update when the connection is back.";

/** A tap refused because another dose write is still in flight (not merely cooling down). */
export const STILL_SAVING_TOAST = "Still saving your last change…";

/**
 * A create's Undo pressed after its offer's deadline (a backgrounded tab's
 * timers ran late). Nothing is sent, so the dose is still logged. A restore
 * past its deadline says the server's RESTORE_GONE_MESSAGE instead; its "Log
 * it again" would be wrong here, and could cost a second dose.
 */
export const CREATE_UNDO_GONE_MESSAGE = "Too late to undo. The dose is still in your log.";

/** Shown on the Undo offer when Undo is pressed offline. Nothing was sent, and the offer stays. */
export const UNDO_OFFLINE_MESSAGE = "You're offline — Undo will still be here when you're back.";

/** Shown on the Undo offer when its request failed on the network. The offer stays and can be retried. */
export const UNDO_NETWORK_MESSAGE =
  "Couldn't reach the server. The undo may not have gone through.";
