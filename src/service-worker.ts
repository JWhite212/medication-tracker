/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
declare let self: ServiceWorkerGlobalScope;

import { build, files, version } from "$service-worker";

const CACHE = `medtracker-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  const isStaticAsset = ASSETS.includes(url.pathname);

  if (isStaticAsset) {
    // Cache-first for build assets and static files
    event.respondWith(
      caches.match(event.request).then((r) => r ?? fetch(event.request)),
    );
  } else {
    // Network-first for pages/API — never cache authenticated responses
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .match(event.request)
          .then((r) => r ?? new Response("Offline", { status: 503 })),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title ?? "MedTracker", {
      body: data.body ?? "You have a medication reminder",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag ?? "medication-reminder",
      data: { url: data.url ?? "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data?.url as string) ?? "/dashboard";
  // Only allow same-origin relative paths to prevent open redirect
  const url = raw.startsWith("/") ? raw : "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && "focus" in client)
          return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
