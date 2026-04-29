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

export async function sendPushNotification(
  userId: string,
  payload: { title: string; body: string; url?: string; tag?: string },
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return [];

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
  return results;
}

export function getVapidPublicKey(): string | null {
  return env.VAPID_PUBLIC_KEY ?? null;
}
