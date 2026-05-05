import webpush from "web-push";
import { env } from "$env/dynamic/private";
import { db } from "$lib/server/db";
import { pushSubscriptions } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";

if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    "mailto:" + (env.VAPID_EMAIL ?? "noreply@example.com"),
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
}

export type PushErrorReason = "not_configured" | "no_subscriptions" | "all_failed";

export type PushResult =
  | { ok: true; deliveredCount: number }
  | { ok: false; reason: PushErrorReason; message: string };

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
    return { ok: false, reason: "all_failed", message };
  }
  return { ok: true, deliveredCount: delivered };
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}
