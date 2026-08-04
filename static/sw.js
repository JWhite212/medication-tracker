/*
 * MedTracker service worker — push notifications only.
 *
 * Deliberately has NO fetch handler and does NO asset caching, so it can
 * never serve stale HTML/JS. Its sole job is to receive Web Push events
 * (dispatched by src/lib/server/push.ts as { title, body, url?, tag? })
 * and show/route notifications. Registered app-wide from the
 * authenticated layout; inert until the user enables push and a
 * subscription exists.
 */

// Take control on first load so navigator.serviceWorker.ready resolves
// promptly (the settings toggle awaits it) instead of waiting for every
// tab to close.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "MedTracker";
  const url = payload.url || "/dashboard";
  const options = {
    body: payload.body || "",
    tag: payload.tag,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/dashboard";
  // Only navigate to same-origin paths — "//host" is protocol-relative
  // and would leave the app, so it falls back too. Payload URLs are
  // server-authored today; this keeps a future dynamic-URL reminder
  // from becoming an open redirect.
  const url =
    typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus an existing window if one is open, navigating it to the
      // target; otherwise open a fresh one.
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
