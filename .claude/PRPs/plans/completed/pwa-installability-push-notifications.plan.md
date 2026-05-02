# Plan: PWA & Installability with Web Push Notifications

## Summary

Transform MedTracker from a server-rendered web app into a fully installable PWA with offline caching, app-like experience, and Web Push notifications for medication reminders. This directly addresses the #1 competitor pain point (unreliable notifications) and the #1 reason medication apps fail.

## User Story

As a medication tracker user,
I want to install MedTracker on my device and receive push notifications for overdue doses,
So that I never miss a medication reminder even when the browser tab is closed.

## Problem → Solution

Users must keep a browser tab open and rely on email-only reminders → Users install the app to their home screen, get instant push notifications, and have basic offline access to their medication list.

## Metadata

- **Complexity**: Large
- **Source PRD**: N/A (from opportunity map Theme B)
- **PRD Phase**: N/A
- **Estimated Files**: 14

---

## UX Design

### Before

```
┌──────────────────────────────────────┐
│  Browser tab → MedTracker            │
│  ┌────────────────────────────────┐  │
│  │  Dashboard with medications    │  │
│  │  Live timers counting up       │  │
│  │  No install prompt             │  │
│  │  No push notifications         │  │
│  │  Email-only reminders (cron)   │  │
│  │  Blank screen when offline     │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### After

```
┌──────────────────────────────────────┐
│  Standalone app window (no URL bar)  │
│  ┌────────────────────────────────┐  │
│  │  Dashboard with medications    │  │
│  │  Live timers counting up       │  │
│  │  "Install App" banner (first)  │  │
│  │  Push notification toggle ON   │  │
│  │  Offline: cached med list      │  │
│  └────────────────────────────────┘  │
│                                      │
│  [notification]  MedTracker          │
│  "Ibuprofen overdue by 2h"          │
│  [View Dashboard]                    │
└──────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint             | Before             | After                              | Notes                   |
| ---------------------- | ------------------ | ---------------------------------- | ----------------------- |
| First visit            | Normal page load   | Install banner after 2nd visit     | BeforeInstallPrompt     |
| Notifications settings | Email toggles only | Email + Push toggles               | Permission request flow |
| Offline                | Blank error        | Cached app shell + medication list | Service worker cache    |
| Overdue reminder       | Email only         | Email + push notification          | Cron sends both         |
| Home screen            | Browser bookmark   | Native-looking app icon            | PWA manifest            |

---

## Mandatory Reading

| Priority | File                                                      | Lines   | Why                                             |
| -------- | --------------------------------------------------------- | ------- | ----------------------------------------------- |
| P0       | `src/lib/server/db/schema.ts`                             | all     | Schema pattern for new pushSubscriptions table  |
| P0       | `src/lib/server/reminders.ts`                             | all     | Cron logic to extend with push sending          |
| P0       | `static/manifest.json`                                    | all     | Current manifest to enhance                     |
| P0       | `src/app.html`                                            | all     | Meta tags + manifest link                       |
| P0       | `svelte.config.js`                                        | all     | CSP directives to update                        |
| P1       | `src/routes/(app)/settings/notifications/+page.svelte`    | all     | UI to add push toggle                           |
| P1       | `src/routes/(app)/settings/notifications/+page.server.ts` | all     | Server action pattern for push subscribe        |
| P1       | `src/lib/utils/validation.ts`                             | 131-140 | notificationSchema to extend                    |
| P1       | `src/hooks.server.ts`                                     | all     | Security headers, session validation            |
| P2       | `src/routes/(app)/+layout.svelte`                         | all     | Layout for install prompt placement             |
| P2       | `src/lib/components/ui/Toast.svelte`                      | all     | Toast pattern for install/notification feedback |
| P2       | `src/lib/server/email.ts`                                 | all     | Email sending pattern to mirror for push        |

---

## Patterns to Mirror

### SCHEMA_TABLE_DEFINITION

```typescript
// SOURCE: src/lib/server/db/schema.ts:31-41
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);
```

### SERVER_ACTION_WITH_VALIDATION

```typescript
// SOURCE: src/routes/(app)/settings/notifications/+page.server.ts:15-46
export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = notificationSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    const before = await getOrCreatePreferences(locals.user!.id);
    const updated = await updatePreferences(locals.user!.id, parsed.data);

    const changes = computeChanges(/* before, after */);
    if (changes)
      await logAudit(locals.user!.id, "user_preferences", locals.user!.id, "update", changes);

    return { success: true };
  },
};
```

### API_ROUTE_WITH_AUTH

```typescript
// SOURCE: src/routes/api/cron/reminders/+server.ts (pattern)
import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) throw error(401);
  // ... logic
  return json({ success: true });
};
```

### NOTIFICATION_SETTINGS_UI

```svelte
<!-- SOURCE: src/routes/(app)/settings/notifications/+page.svelte:24-35 -->
<div class="flex items-center justify-between">
  <div>
    <p class="text-sm font-medium">Email Reminders</p>
    <p class="text-text-muted text-xs">Receive email when a medication dose is overdue</p>
  </div>
  <input
    type="checkbox"
    name="emailReminders"
    checked={data.preferences.emailReminders}
    class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
  />
</div>
```

### TOAST_FEEDBACK

```typescript
// SOURCE: src/lib/components/ui/Toast.svelte:11-21
import { showToast } from "$lib/components/ui/Toast.svelte";
showToast("Push notifications enabled", "success");
```

---

## Files to Change

| File                                                      | Action       | Justification                                        |
| --------------------------------------------------------- | ------------ | ---------------------------------------------------- |
| `static/manifest.json`                                    | UPDATE       | Full PWA manifest with icons, shortcuts, screenshots |
| `static/icons/`                                           | CREATE (dir) | PNG icon set generated from SVG                      |
| `src/app.html`                                            | UPDATE       | Apple meta tags for iOS install                      |
| `src/service-worker.ts`                                   | CREATE       | SvelteKit service worker with caching + push handler |
| `svelte.config.js`                                        | UPDATE       | Add worker-src CSP directive                         |
| `src/lib/server/db/schema.ts`                             | UPDATE       | Add pushSubscriptions table                          |
| `src/lib/server/push.ts`                                  | CREATE       | Web Push send utility (VAPID + web-push)             |
| `src/routes/api/push/subscribe/+server.ts`                | CREATE       | Push subscription endpoint                           |
| `src/routes/api/push/unsubscribe/+server.ts`              | CREATE       | Push unsubscription endpoint                         |
| `src/routes/(app)/settings/notifications/+page.svelte`    | UPDATE       | Add push notification toggle + permission UI         |
| `src/routes/(app)/settings/notifications/+page.server.ts` | UPDATE       | Return VAPID public key from load                    |
| `src/lib/server/reminders.ts`                             | UPDATE       | Send push notifications alongside email              |
| `src/lib/utils/validation.ts`                             | UPDATE       | Add push subscription Zod schema                     |
| `scripts/generate-icons.mjs`                              | CREATE       | One-time script to generate PWA icons from SVG       |

## NOT Building

- Light mode theme (separate theme)
- Background sync for offline dose logging (complex, separate feature)
- Full offline-first with IndexedDB (separate, needs conflict resolution)
- Push notification scheduling on client (server-driven only)
- Badge API for unread count
- Periodic background sync
- Share Target API

---

## Step-by-Step Tasks

### Task 1: Generate PWA Icon Set

- **ACTION**: Create a Node script to generate PNG icons from the existing SVG favicon, then run it
- **IMPLEMENT**: Script using `sharp` to convert `src/lib/assets/favicon.svg` to PNGs at 192x192, 512x512, 180x180 (apple-touch), and a maskable 512x512 variant. Output to `static/icons/`. Also generate `favicon.ico` at 32x32.
- **MIRROR**: N/A (one-time build script)
- **IMPORTS**: `sharp` (add as devDependency)
- **GOTCHA**: SVG viewBox must be read correctly. The existing favicon.svg is 1.6KB — verify it renders at target sizes. Maskable icons need 10% safe zone padding.
- **VALIDATE**: `ls static/icons/` shows icon-192.png, icon-512.png, apple-touch-icon.png, icon-maskable-512.png. Each file is > 0 bytes and opens correctly.

### Task 2: Update manifest.json + app.html Meta Tags

- **ACTION**: Rewrite `static/manifest.json` with full PWA manifest. Update `src/app.html` with Apple-specific meta tags.
- **IMPLEMENT**:
  ```json
  {
    "name": "MedTracker",
    "short_name": "MedTracker",
    "description": "Personal medication tracker with dose logging, live timers, and adherence analytics.",
    "start_url": "/dashboard",
    "display": "standalone",
    "background_color": "#0a0a0f",
    "theme_color": "#6366f1",
    "orientation": "any",
    "categories": ["health", "medical", "lifestyle"],
    "icons": [
      { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
      { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
      {
        "src": "/icons/icon-maskable-512.png",
        "sizes": "512x512",
        "type": "image/png",
        "purpose": "maskable"
      },
      { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" }
    ],
    "shortcuts": [
      {
        "name": "Log Dose",
        "url": "/dashboard",
        "description": "Log a medication dose"
      },
      {
        "name": "Medications",
        "url": "/medications",
        "description": "View medications"
      }
    ]
  }
  ```
  Add to `<head>` in `src/app.html`:
  ```html
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="MedTracker" />
  ```
- **MIRROR**: Existing manifest.json structure
- **IMPORTS**: None
- **GOTCHA**: The `start_url` must be `/dashboard` (not `/`) since unauthenticated users redirect to login. Apple meta tags must go before `%sveltekit.head%`. Move apple-touch-icon PNG to `static/icons/` (not `static/`).
- **VALIDATE**: Run Lighthouse PWA audit — manifest should score green. Check Chrome DevTools > Application > Manifest shows all icons resolved.

### Task 3: Create Service Worker with Caching Strategy

- **ACTION**: Create `src/service-worker.ts` using SvelteKit's `$service-worker` module with cache-first for assets, network-first for pages, and push notification handler.
- **IMPLEMENT**:

  ```typescript
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
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
    );
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== location.origin) return;

    const isAsset = ASSETS.includes(url.pathname);
    event.respondWith(
      isAsset
        ? caches.match(event.request).then((r) => r ?? fetch(event.request))
        : fetch(event.request)
            .then((response) => {
              if (response.ok && response.status === 200) {
                const clone = response.clone();
                caches.open(CACHE).then((c) => c.put(event.request, clone));
              }
              return response;
            })
            .catch(() =>
              caches
                .match(event.request)
                .then((r) => r ?? new Response("Offline", { status: 503 })),
            ),
    );
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
    const url = event.notification.data?.url ?? "/dashboard";
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((list) => {
        for (const client of list) {
          if (client.url.includes(url) && "focus" in client) return client.focus();
        }
        return self.clients.openWindow(url);
      }),
    );
  });
  ```

- **MIRROR**: N/A (new file type, follows SvelteKit service worker convention)
- **IMPORTS**: `$service-worker` (SvelteKit built-in)
- **GOTCHA**: SvelteKit auto-registers the service worker when `src/service-worker.ts` exists. The `$service-worker` module only works inside service-worker.ts. The `files` array includes everything in `static/`. Don't cache API routes. The `tag` on showNotification deduplicates — same tag replaces previous notification.
- **VALIDATE**: `npm run build` succeeds. Dev server shows service worker registered in Chrome DevTools > Application > Service Workers. Offline checkbox in DevTools shows cached pages.

### Task 4: Update CSP for Service Worker

- **ACTION**: Add `worker-src` directive to CSP in `svelte.config.js`
- **IMPLEMENT**: Add `"worker-src": ["self"]` to the CSP directives object
- **MIRROR**: Existing CSP pattern in `svelte.config.js:11-20`
- **IMPORTS**: None
- **GOTCHA**: `worker-src` falls back to `child-src` then `default-src`. Being explicit is better. Don't add `blob:` unless needed — SvelteKit serves the SW as a regular file.
- **VALIDATE**: Service worker registers without CSP console errors. Check Response headers include `worker-src 'self'`.

### Task 5: Push Notifications — DB Schema + Server Utility

- **ACTION**: Add `pushSubscriptions` table to schema.ts. Create `src/lib/server/push.ts` for VAPID-based push sending.
- **IMPLEMENT**:
  Schema addition:

  ```typescript
  export const pushSubscriptions = pgTable(
    "push_subscriptions",
    {
      id: text("id").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      endpoint: text("endpoint").notNull().unique(),
      p256dh: text("p256dh").notNull(),
      auth: text("auth").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index("push_subscriptions_user_idx").on(table.userId)],
  );
  ```

  Push utility (`src/lib/server/push.ts`):

  ```typescript
  import webpush from "web-push";
  import { env } from "$env/dynamic/private";
  import { db } from "$lib/server/db";
  import { pushSubscriptions } from "$lib/server/db/schema";
  import { eq } from "drizzle-orm";

  webpush.setVapidDetails(
    "mailto:" + (env.VAPID_EMAIL ?? "noreply@example.com"),
    env.VAPID_PUBLIC_KEY!,
    env.VAPID_PRIVATE_KEY!,
  );

  export async function sendPushNotification(
    userId: string,
    payload: { title: string; body: string; url?: string; tag?: string },
  ) {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));

    const results = await Promise.allSettled(
      subs.map((sub) =>
        webpush
          .sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
          )
          .catch(async (err) => {
            if (err.statusCode === 410 || err.statusCode === 404) {
              await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
            }
            throw err;
          }),
      ),
    );
    return results;
  }

  export function getVapidPublicKey(): string {
    return env.VAPID_PUBLIC_KEY ?? "";
  }
  ```

- **MIRROR**: Schema: `sessions` table pattern (schema.ts:31-41). Utility: `email.ts` send pattern.
- **IMPORTS**: `web-push` (add as dependency), `$env/dynamic/private`, `drizzle-orm`
- **GOTCHA**: VAPID keys must be generated once via `npx web-push generate-vapid-keys` and stored as env vars. The `endpoint` column has `unique()` to prevent duplicate subscriptions. Auto-cleanup expired/revoked subscriptions on 410/404 responses. Always run `npx drizzle-kit generate` then `npx drizzle-kit push` after schema change.
- **VALIDATE**: `npx drizzle-kit generate` creates migration. `npx drizzle-kit push` applies without error. TypeScript compiles cleanly.

### Task 6: Push Notifications — API Endpoints

- **ACTION**: Create subscribe and unsubscribe API routes for push subscriptions
- **IMPLEMENT**:
  `src/routes/api/push/subscribe/+server.ts`:

  ```typescript
  import { json, error } from "@sveltejs/kit";
  import { db } from "$lib/server/db";
  import { pushSubscriptions } from "$lib/server/db/schema";
  import { createId } from "@paralleldrive/cuid2";
  import { pushSubscriptionSchema } from "$lib/utils/validation";
  import type { RequestHandler } from "./$types";

  export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) throw error(401);
    const body = await request.json();
    const parsed = pushSubscriptionSchema.safeParse(body);
    if (!parsed.success) throw error(400, "Invalid subscription");

    const { endpoint, keys } = parsed.data;

    await db
      .insert(pushSubscriptions)
      .values({
        id: createId(),
        userId: locals.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { p256dh: keys.p256dh, auth: keys.auth, userId: locals.user.id },
      });

    return json({ success: true });
  };
  ```

  `src/routes/api/push/unsubscribe/+server.ts`:

  ```typescript
  import { json, error } from "@sveltejs/kit";
  import { db } from "$lib/server/db";
  import { pushSubscriptions } from "$lib/server/db/schema";
  import { and, eq } from "drizzle-orm";
  import type { RequestHandler } from "./$types";

  export const POST: RequestHandler = async ({ request, locals }) => {
    if (!locals.user) throw error(401);
    const { endpoint } = await request.json();
    if (!endpoint) throw error(400);

    await db
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.userId, locals.user.id), eq(pushSubscriptions.endpoint, endpoint)),
      );

    return json({ success: true });
  };
  ```

- **MIRROR**: API route pattern from `src/routes/api/cron/reminders/+server.ts`. Auth check via `locals.user`. Zod validation.
- **IMPORTS**: `@sveltejs/kit`, `drizzle-orm`, `@paralleldrive/cuid2`
- **GOTCHA**: Use `onConflictDoUpdate` on endpoint to handle re-subscriptions (browser regenerates keys). The unsubscribe endpoint scopes deletion by `userId` AND `endpoint` to prevent users deleting other users' subscriptions.
- **VALIDATE**: `npm run build` compiles. POST to /api/push/subscribe with valid subscription JSON returns 200. POST without auth returns 401.

### Task 7: Push Notifications — Settings UI + Permission Flow

- **ACTION**: Add push notification toggle to notification settings page with browser permission request flow
- **IMPLEMENT**: Add a push notification section to `src/routes/(app)/settings/notifications/+page.svelte` between the existing toggles and the save button. This section works via client-side JavaScript (not form action) since it interacts with the Push API directly.

  ```svelte
  <script lang="ts">
    import { showToast } from "$lib/components/ui/Toast.svelte";

    let pushSupported = $state(false);
    let pushEnabled = $state(false);
    let pushLoading = $state(false);

    $effect(() => {
      pushSupported = "serviceWorker" in navigator && "PushManager" in window;
      if (pushSupported) checkPushStatus();
    });

    async function checkPushStatus() {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      pushEnabled = sub !== null;
    }

    async function togglePush() {
      pushLoading = true;
      try {
        const reg = await navigator.serviceWorker.ready;
        if (pushEnabled) {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            await fetch("/api/push/unsubscribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ endpoint: sub.endpoint }),
            });
            await sub.unsubscribe();
          }
          pushEnabled = false;
          showToast("Push notifications disabled", "success");
        } else {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            showToast("Notification permission denied", "error");
            return;
          }
          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: data.vapidPublicKey,
          });
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(sub.toJSON()),
          });
          pushEnabled = true;
          showToast("Push notifications enabled", "success");
        }
      } finally {
        pushLoading = false;
      }
    }
  </script>
  ```

  Server load function must return `vapidPublicKey`:

  ```typescript
  import { getVapidPublicKey } from "$lib/server/push";
  // In load:
  return { preferences: prefs, vapidPublicKey: getVapidPublicKey() };
  ```

- **MIRROR**: Toggle UI pattern from existing email/inventory checkboxes (notifications/+page.svelte:24-35). Toast feedback pattern.
- **IMPORTS**: `$lib/components/ui/Toast.svelte` (showToast), `$lib/server/push` (getVapidPublicKey)
- **GOTCHA**: Push toggle is client-side JS, not a form action — it calls the Push API directly. The `applicationServerKey` must be the VAPID public key (base64url encoded). `userVisibleOnly: true` is required by Chrome. If permission is `denied` (not `default`), the browser won't show the prompt again — show a message telling the user to enable in browser settings. Must check `'serviceWorker' in navigator` before accessing PushManager (SSR safety).
- **VALIDATE**: Toggle shows in notification settings. Clicking it triggers browser permission prompt. After granting, subscription appears in DB. After toggling off, subscription is removed.

### Task 8: Update Reminders Cron to Send Push Notifications

- **ACTION**: Modify `src/lib/server/reminders.ts` to send push notifications alongside emails
- **IMPLEMENT**: After the existing `sendReminderEmail` call, also send a push notification:

  ```typescript
  import { sendPushNotification } from "./push";

  // Inside the for loop, after sendReminderEmail:
  try {
    await sendPushNotification(med.userId, {
      title: `${med.medicationName} overdue`,
      body: `Last taken ${formatTimeSince(new Date(lastDose.takenAt))} ago`,
      url: "/dashboard",
      tag: `overdue-${med.medicationId}`,
    });
  } catch {
    // Push failure should not block email sending
  }
  ```

- **MIRROR**: Existing email send pattern in `reminders.ts:44-48`
- **IMPORTS**: `$lib/server/push` (sendPushNotification)
- **GOTCHA**: Push failures should not block email sending — wrap in try/catch. The `tag` per medication deduplicates notifications so users don't get spammed. The N+1 query issue (individual dose lookup per medication) already exists — don't make it worse, but don't fix it in this PR either.
- **VALIDATE**: Trigger the cron endpoint manually. User with push subscription receives a notification. User without subscription still gets email.

### Task 9: Add Validation Schema + Environment Variables

- **ACTION**: Add Zod schema for push subscription validation. Add VAPID env vars to .env.example.
- **IMPLEMENT**:
  In `src/lib/utils/validation.ts`:
  ```typescript
  export const pushSubscriptionSchema = z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  });
  ```
  In `.env.example`:
  ```
  VAPID_PUBLIC_KEY=
  VAPID_PRIVATE_KEY=
  VAPID_EMAIL=
  ```
- **MIRROR**: Existing Zod schema pattern in `validation.ts`
- **IMPORTS**: `zod`
- **GOTCHA**: The push subscription JSON from `sub.toJSON()` includes `endpoint`, `expirationTime`, and `keys: { p256dh, auth }`. Only validate what we store. Generate VAPID keys once: `npx web-push generate-vapid-keys`.
- **VALIDATE**: TypeScript compiles. Schema correctly validates a real PushSubscription JSON.

### Task 10: Verify & Test Full PWA

- **ACTION**: Run Lighthouse PWA audit, test install flow, test push notifications, test offline caching
- **IMPLEMENT**: N/A (verification only)
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: Lighthouse PWA audit requires HTTPS — use `npm run build && npm run preview` with a local HTTPS proxy, or test on the Vercel preview deployment. Service workers don't work on `localhost` in some browsers (Chrome allows it, Safari doesn't).
- **VALIDATE**: See Validation Commands section below.

---

## Testing Strategy

### Unit Tests

| Test                                        | Input                                                               | Expected Output                     | Edge Case? |
| ------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- | ---------- |
| pushSubscriptionSchema accepts valid sub    | `{ endpoint: "https://...", keys: { p256dh: "...", auth: "..." } }` | Success                             | No         |
| pushSubscriptionSchema rejects missing keys | `{ endpoint: "https://..." }`                                       | ZodError                            | Yes        |
| pushSubscriptionSchema rejects invalid URL  | `{ endpoint: "not-a-url", keys: {...} }`                            | ZodError                            | Yes        |
| sendPushNotification handles 410            | Expired subscription                                                | Deletes subscription, doesn't throw | Yes        |

### Edge Cases Checklist

- [ ] User denies notification permission
- [ ] User revokes permission after granting
- [ ] Push subscription expires (410 response)
- [ ] Multiple devices for same user (multiple subscriptions)
- [ ] Offline → cache serves stale content
- [ ] Service worker update (new version cache)
- [ ] VAPID keys not configured (graceful fallback)
- [ ] Browser doesn't support service workers (SSR still works)

---

## Validation Commands

### Static Analysis

```bash
npx svelte-check --tsconfig ./tsconfig.json
```

EXPECT: Zero type errors

### Build

```bash
npm run build
```

EXPECT: Clean build, service-worker.js in output

### Database Migration

```bash
npx drizzle-kit generate
npx drizzle-kit push
```

EXPECT: Migration generated for push_subscriptions table, applied cleanly

### Lighthouse PWA Audit

```bash
npm run build && npm run preview
# In Chrome: DevTools > Lighthouse > PWA category
```

EXPECT: Installable, has manifest, has service worker, works offline (basic)

### Manual Validation

- [ ] Chrome DevTools > Application > Manifest shows all icons
- [ ] "Install app" prompt appears (or 3-dot menu > Install)
- [ ] After install, app opens in standalone window
- [ ] Notification settings shows push toggle
- [ ] Granting permission stores subscription in DB
- [ ] Revoking removes subscription
- [ ] Triggering cron sends push notification to subscribed device
- [ ] Offline mode shows cached dashboard (not blank)
- [ ] iOS Safari: Add to Home Screen shows correct icon/name

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Manifest passes Lighthouse PWA installability check
- [ ] Service worker caches app shell for offline access
- [ ] Push notifications delivered to subscribed users
- [ ] Install flow works on Chrome Android + Desktop
- [ ] iOS Add to Home Screen shows correct icon
- [ ] No CSP violations in console
- [ ] VAPID keys documented in .env.example
- [ ] Existing email reminders still work

## Completion Checklist

- [ ] Schema follows existing table patterns (text PK, userId FK, timestamps)
- [ ] API routes validate input with Zod
- [ ] Push failures don't break email sending
- [ ] Expired subscriptions auto-cleaned
- [ ] No hardcoded VAPID keys
- [ ] CSP updated for worker-src
- [ ] Apple meta tags for iOS install

## Risks

| Risk                                     | Likelihood | Impact | Mitigation                                                |
| ---------------------------------------- | ---------- | ------ | --------------------------------------------------------- |
| Push API not supported in Safari < 16.4  | Medium     | Medium | Graceful fallback — push section hidden if unsupported    |
| VAPID key rotation needed                | Low        | Medium | Keys are long-lived; document rotation process            |
| Service worker caching stale data        | Medium     | Low    | Version-based cache busting via `$service-worker` version |
| Vercel serverless cold start delays push | Low        | Low    | Push sending is fire-and-forget in cron                   |

## Notes

- VAPID keys: Generate once with `npx web-push generate-vapid-keys` and add to Vercel env vars
- The existing N+1 query in reminders.ts (one query per medication) is a known issue but out of scope for this plan
- Web Push requires HTTPS in production (Vercel handles this)
- SvelteKit auto-registers the service worker when `src/service-worker.ts` exists
- The `web-push` npm package handles VAPID signing and payload encryption
