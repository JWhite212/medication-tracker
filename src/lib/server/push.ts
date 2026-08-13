import { env } from "$env/dynamic/private";
import { db } from "$lib/server/db";
import { pushSubscriptions, reminderEvents } from "$lib/server/db/schema";
import { TEST_PUSH_TAG } from "$lib/utils/push";
import { eq, sql } from "drizzle-orm";

// Lazy so the web-push package is only loaded on paths that actually
// dispatch a notification (reminder cron, subscribe test pings) — not
// on every request that touches the reminders module graph. VAPID
// details are configured once, on first use.
type WebPush = typeof import("web-push");
let webpushOnce: Promise<WebPush> | null = null;
function getWebpush(): Promise<WebPush> {
  webpushOnce ??= import("web-push").then(({ default: webpush }) => {
    webpush.setVapidDetails(
      "mailto:" + (env.VAPID_EMAIL ?? "noreply@example.com"),
      env.VAPID_PUBLIC_KEY!,
      env.VAPID_PRIVATE_KEY!,
    );
    return webpush;
  });
  return webpushOnce;
}

export type PushErrorReason = "not_configured" | "no_subscriptions" | "all_failed";

// attemptedCount/prunedCount let a caller report "delivered to 2 of 3
// devices, removed 1 expired registration". They are optional on the
// failure variant because not_configured and no_subscriptions never
// reach the send loop and so have nothing to count.
export type PushResult =
  | { ok: true; deliveredCount: number; attemptedCount: number; prunedCount: number }
  | {
      ok: false;
      reason: PushErrorReason;
      message: string;
      attemptedCount?: number;
      prunedCount?: number;
    };

function isVapidConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

/**
 * Returns true when the user has at least one active push subscription
 * AND VAPID is configured. The reminder dispatcher uses this to decide
 * whether to mark the push channel as configured-for-this-attempt.
 */
export async function hasPushSubscriptions(userId: string): Promise<boolean> {
  if (!isVapidConfigured()) return false;
  const [row] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .limit(1);
  return row !== undefined;
}

export async function sendPushNotification(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
): Promise<PushResult> {
  if (!isVapidConfigured()) {
    return { ok: false, reason: "not_configured", message: "VAPID keys are not set." };
  }

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  if (subs.length === 0) {
    return {
      ok: false,
      reason: "no_subscriptions",
      message: "User has no active push subscriptions.",
    };
  }

  const webpush = await getWebpush();

  // Incremented from the rejection handler below. Safe as a plain
  // counter: the handlers are async but JS runs them one at a time,
  // and every one has settled by the time allSettled resolves.
  let prunedCount = 0;

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
        .catch(async (err: unknown) => {
          const statusCode =
            err instanceof Error && "statusCode" in err
              ? (err as { statusCode: number }).statusCode
              : undefined;
          if (statusCode === 410 || statusCode === 404) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
            prunedCount++;
          }
          throw err;
        }),
    ),
  );

  const delivered = results.filter((r) => r.status === "fulfilled").length;
  if (delivered === 0) {
    const firstFailure = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    const message =
      firstFailure?.reason instanceof Error
        ? firstFailure.reason.message
        : "All push subscriptions failed.";
    // Endpoints and payloads are intentionally not echoed in the
    // message so the dispatcher's last_error stays non-sensitive.
    return {
      ok: false,
      reason: "all_failed",
      message,
      attemptedCount: subs.length,
      prunedCount,
    };
  }
  return {
    ok: true,
    deliveredCount: delivered,
    attemptedCount: subs.length,
    prunedCount,
  };
}

/**
 * Fire a user-initiated test notification to every device the user has
 * registered. The payload is fixed — no caller- or user-supplied text
 * reaches the notification body.
 *
 * The tag deliberately differs from the service worker's reminder tag:
 * notifications sharing a tag replace one another, so reusing it would
 * let a test quietly clear a real reminder out of the tray.
 */
export function sendTestPush(userId: string): Promise<PushResult> {
  return sendPushNotification(userId, {
    title: "MedTracker test notification",
    body: "Push notifications are working on this device.",
    url: "/settings/notifications",
    tag: TEST_PUSH_TAG,
  });
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}

export type PushHealth = {
  vapidConfigured: boolean;
  deviceCount: number;
  oldestRegisteredAt: Date | null;
  /**
   * The most recent reminder attempt for this user, whatever its
   * outcome. This is the closest thing to a liveness signal for the
   * reminder scheduler that the schema can offer: during the 2026
   * outage the cron never ran, so no row was written or touched at all
   * and this timestamp would have been months stale.
   *
   * It is deliberately reported as a fact rather than a verdict. Null
   * is not evidence of a fault — a user who is never overdue never
   * generates a reminder event.
   */
  lastReminderAt: Date | null;
};

/**
 * Read-only diagnostics for the notifications settings page. Scoped to
 * a single user; never aggregates across accounts.
 */
export async function getPushHealth(userId: string): Promise<PushHealth> {
  const [devices] = await db
    .select({
      deviceCount: sql<number>`count(*)::int`,
      oldestRegisteredAt: sql<Date | null>`min(${pushSubscriptions.createdAt})`,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));

  const [reminders] = await db
    .select({ lastReminderAt: sql<Date | null>`max(${reminderEvents.lastAttemptAt})` })
    .from(reminderEvents)
    .where(eq(reminderEvents.userId, userId));

  return {
    vapidConfigured: isVapidConfigured(),
    deviceCount: devices?.deviceCount ?? 0,
    oldestRegisteredAt: devices?.oldestRegisteredAt ?? null,
    lastReminderAt: reminders?.lastReminderAt ?? null,
  };
}

function devices(count: number): string {
  return count === 1 ? "device" : "devices";
}

/**
 * Turn a PushResult into the sentence shown to the user.
 *
 * This is the boundary that keeps push-service detail server-side: the
 * `message` carried on a failed PushResult can contain the provider's
 * own error text, so it is never forwarded. Only the categorised reason
 * and the counts cross to the client.
 */
export function describeTestPushResult(result: PushResult): { ok: boolean; message: string } {
  if (result.ok) {
    const { deliveredCount, attemptedCount, prunedCount } = result;
    const parts = [
      deliveredCount === attemptedCount
        ? `Test notification sent to ${deliveredCount} ${devices(deliveredCount)}.`
        : `Test notification sent to ${deliveredCount} of ${attemptedCount} registered devices.`,
    ];
    if (prunedCount > 0) {
      parts.push(
        `Removed ${prunedCount} expired device registration${prunedCount === 1 ? "" : "s"}.`,
      );
    }
    return { ok: true, message: parts.join(" ") };
  }

  switch (result.reason) {
    case "not_configured":
      return {
        ok: false,
        message: "Push notifications are not configured on this deployment.",
      };
    case "no_subscriptions":
      return {
        ok: false,
        message: "No devices are registered yet. Enable push on this device first.",
      };
    case "all_failed": {
      const attempted = result.attemptedCount ?? 0;
      const pruned = result.prunedCount ?? 0;
      const tail =
        pruned > 0
          ? ` ${pruned} expired registration${pruned === 1 ? " was" : "s were"} removed — re-enable push on ${pruned === 1 ? "that device" : "those devices"}.`
          : "";
      return {
        ok: false,
        message: `None of your ${attempted} registered ${devices(attempted)} accepted the test notification.${tail}`,
      };
    }
  }
}
