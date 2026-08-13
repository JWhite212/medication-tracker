/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

import { build, files, version } from "$service-worker";
import { TEST_PUSH_TAG, TEST_PUSH_SHOWN_MESSAGE } from "$lib/utils/push";

const CACHE = `medtracker-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener("install", (event) => {
  // skipWaiting so this worker takes over promptly rather than waiting
  // for every tab to close. An installed PWA is rarely fully closed, and
  // it is what lets a device still running the old, now-deleted /sw.js
  // migrate on the next load. Safe here because cache-first applies only
  // to content-hashed build assets; pages and API responses are always
  // network-first.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isStaticAsset = ASSETS.includes(url.pathname);

  if (isStaticAsset) {
    // Cache-first for build assets and static files
    event.respondWith(caches.match(event.request).then((r) => r ?? fetch(event.request)));
  } else {
    // Network-first for pages/API — never cache authenticated responses
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((r) => r ?? new Response("Offline", { status: 503 })),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  const tag = data.tag ?? "medication-reminder";
  event.waitUntil(
    self.registration
      .showNotification(data.title ?? "MedTracker", {
        body: data.body ?? "You have a medication reminder",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag,
        data: { url: data.url ?? "/dashboard" },
      })
      // "The push service accepted it" is not the same as "the user saw
      // it" — the OS can suppress a notification after delivery, which
      // is exactly the case someone reaches for the test button to
      // diagnose. Telling the open page that showNotification actually
      // resolved closes that gap. Only test notifications report back,
      // so real reminders stay silent to the page.
      .then(async () => {
        if (tag !== TEST_PUSH_TAG) return;
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) {
          client.postMessage({ type: TEST_PUSH_SHOWN_MESSAGE });
        }
      }),
  );
});

/**
 * The browser rotates or expires push subscriptions periodically. With
 * no handler for that, the endpoint stored server-side silently goes
 * dead and reminders stop arriving with nothing in the UI to say so —
 * which is how the production subscriptions reached three months old
 * with no renewal path.
 *
 * `pushsubscriptionchange` is not in TypeScript's DOM lib, so the event
 * shape is declared locally and the listener cast.
 */
type PushSubscriptionChangeEvent = ExtendableEvent & {
  readonly newSubscription?: PushSubscription | null;
  readonly oldSubscription?: PushSubscription | null;
};

self.addEventListener("pushsubscriptionchange", ((event: PushSubscriptionChangeEvent) => {
  event.waitUntil(
    (async () => {
      // Chrome usually supplies the replacement directly. Otherwise
      // re-subscribe with the previous application server key — inside
      // the worker that is the only copy of the VAPID key available.
      let subscription = event.newSubscription ?? null;
      if (!subscription) {
        const applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
        if (!applicationServerKey) return;
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });
      }
      // A same-origin fetch carries the session cookie, so this
      // authenticates as the signed-in user. The old endpoint is left
      // for the server to reap: the next send gets a 410 and prunes it.
      // Swallow failures — if the session has expired there is no user
      // to tell, and the device re-registers next time Settings opens.
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      }).catch(() => {});
    })(),
  );
}) as EventListener);

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data?.url as string) ?? "/dashboard";
  // Only allow same-origin relative paths to prevent open redirect —
  // "//host" is protocol-relative and would leave the app.
  const url = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
