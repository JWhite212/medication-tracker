/**
 * Sole owner of the push notification wire contract.
 *
 * Both ends live here: senders build a `PushPayload`, the service worker
 * turns received JSON back into notification arguments. Neither writes a
 * tag nor reads a field by hand.
 *
 * This is in `utils/` rather than `server/` because the service worker
 * imports it, and the worker may never reach `$lib/server`.
 *
 * The wire format is frozen. Service workers update lazily, so a push can
 * reach a device whose worker predates the current deploy — renaming or
 * restructuring a field degrades silently for exactly the users who open
 * the app least. New structure goes on the authoring side only.
 */

/** What every sender must produce. All four fields are required. */
export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

/**
 * Tag carried by the user-initiated test notification.
 *
 * Never equal to a reminder tag: notifications sharing a tag replace one
 * another, so a collision would let a test silently clear a real reminder
 * out of the tray. Installed service workers compare against the value
 * compiled into them, so changing this string breaks the render
 * confirmation on every device that has not updated yet.
 */
export const TEST_PUSH_TAG = "medtracker-test";

/** Replace-key for one medication's overdue reminder. */
export function overdueTag(medicationId: string): string {
  return `overdue-${medicationId}`;
}

/** Replace-key for one medication's low-inventory alert. */
export function lowInventoryTag(medicationId: string): string {
  return `low-inventory-${medicationId}`;
}

/**
 * True when a tag was issued as the test tag. The service worker gates
 * its render-confirmation message on this; real reminders stay silent.
 */
export function isTestTag(tag: string | undefined): boolean {
  return tag === TEST_PUSH_TAG;
}
