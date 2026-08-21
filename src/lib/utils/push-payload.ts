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
  /**
   * Re-alert for a notification that replaced an earlier one with the
   * same tag. Additive and optional: the wire format is frozen against
   * renames, and a service worker predating this field simply ignores
   * it, so the replacement lands silently instead of breaking.
   */
  renotify?: boolean;
};

/**
 * `NotificationOptions` in the DOM lib we compile against has no
 * `renotify`, but the field is real: it is specified on the service
 * worker's showNotification(), which TypeScript types separately. The
 * intersection is the minimum needed to express it without reaching for
 * a cast at the assignment.
 */
export type PushNotificationOptions = NotificationOptions & { renotify?: boolean };

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

const DEFAULT_TITLE = "MedTracker";
const DEFAULT_BODY = "You have a medication reminder";
const DEFAULT_URL = "/dashboard";
const ICON = "/icons/icon-192.png";

/**
 * Reduce an arbitrary value to a same-origin relative path.
 *
 * `"//host"` is protocol-relative and would leave the app, so a leading
 * double slash is rejected along with anything that is not a rooted path.
 *
 * Idempotent, which is what lets it run at both ends — once when the url
 * is stored on the notification, once when it is read back on click — so
 * that a future reader is safe by default rather than by remembering.
 */
export function safeNotificationUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_URL;
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : DEFAULT_URL;
}

/**
 * Turn a received push body into arguments for `showNotification()`.
 *
 * Total by construction: the argument is whatever JSON arrived over the
 * wire, so every field falls back independently rather than throwing.
 *
 * A payload with no usable tag gets NO tag rather than a shared default.
 * Tags are a replace-key, so a shared default would let notifications for
 * two different medications overwrite one another and silently lose the
 * first. Untagged notifications merely stack, which is the safe failure.
 */
export function toNotification(raw: unknown): {
  title: string;
  options: PushNotificationOptions;
} {
  const data: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};

  const options: PushNotificationOptions = {
    body: typeof data.body === "string" ? data.body : DEFAULT_BODY,
    icon: ICON,
    badge: ICON,
    data: { url: safeNotificationUrl(data.url) },
  };
  if (typeof data.tag === "string" && data.tag !== "") options.tag = data.tag;
  // renotify is only meaningful alongside a tag, and some browsers throw
  // a TypeError if it is set without one — which would lose the entire
  // notification, not just the re-alert.
  if (options.tag && data.renotify === true) options.renotify = true;

  return {
    title: typeof data.title === "string" ? data.title : DEFAULT_TITLE,
    options,
  };
}
