/**
 * Tag carried by the user-initiated test notification.
 *
 * Shared rather than server-only because three places must agree on it:
 * the sender, the service worker (which posts a confirmation back to the
 * page when it displays one), and the page. It must never equal the
 * reminder tag — notifications sharing a tag replace each other, so a
 * collision would let a test silently clear a real reminder.
 */
export const TEST_PUSH_TAG = "medtracker-test";

/** Message the service worker posts to open pages after showing a test. */
export const TEST_PUSH_SHOWN_MESSAGE = "push-test-shown";

// Convert a base64url-encoded VAPID application server key into the
// Uint8Array that PushManager.subscribe() requires. Chromium rejects a
// raw base64 string for `applicationServerKey`, so the key must be
// decoded to bytes first.
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Build over an explicit ArrayBuffer so the result is a
  // Uint8Array<ArrayBuffer> — the concrete BufferSource that
  // PushManager.subscribe()'s applicationServerKey expects.
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}
