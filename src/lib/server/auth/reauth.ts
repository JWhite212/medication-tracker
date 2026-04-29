import { createId } from "@paralleldrive/cuid2";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "$lib/server/db";
import { reauthTokens, users } from "$lib/server/db/schema";
import { verifyPassword } from "$lib/server/auth/password";
import { createHash, randomBytes } from "crypto";

// Server-side re-authentication tokens for sensitive actions.
//
// confirmReauth(userId, password, purpose):
//   verifies the user's password and inserts a token row, returning the
//   raw token. The row is created with used_at=NULL and expires in
//   REAUTH_TTL_MS. Caller should treat success as "recently
//   re-authenticated for this purpose".
//
// requireRecentReauth(userId, purpose, rawToken):
//   marks the most recent unused, unexpired token for (user, purpose)
//   as consumed and returns true; otherwise returns false. Useful for
//   cross-form flows (e.g., separate reauth page → action page).
//
// During the inline-password-confirmation flow used by the settings
// pages today, callers can simply use confirmReauth() and treat the
// inserted row as the audit trail.

export type ReauthPurpose =
  | "change_password"
  | "enable_2fa"
  | "disable_2fa"
  | "delete_account"
  | "export_data"
  | "revoke_all_sessions";

const REAUTH_TTL_MS = 5 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function confirmReauth(
  userId: string,
  password: string,
  purpose: ReauthPurpose,
): Promise<{ ok: boolean; token?: string }> {
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.passwordHash) return { ok: false };
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return { ok: false };

  const raw = randomBytes(32).toString("hex");
  await db.insert(reauthTokens).values({
    id: createId(),
    userId,
    tokenHash: hashToken(raw),
    purpose,
    expiresAt: new Date(Date.now() + REAUTH_TTL_MS),
  });

  return { ok: true, token: raw };
}

export async function requireRecentReauth(
  userId: string,
  purpose: ReauthPurpose,
  rawToken: string,
): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [row] = await db
    .select({ id: reauthTokens.id })
    .from(reauthTokens)
    .where(
      and(
        eq(reauthTokens.userId, userId),
        eq(reauthTokens.purpose, purpose),
        eq(reauthTokens.tokenHash, tokenHash),
        gt(reauthTokens.expiresAt, now),
        isNull(reauthTokens.usedAt),
      ),
    )
    .limit(1);

  if (!row) return false;

  await db.update(reauthTokens).set({ usedAt: now }).where(eq(reauthTokens.id, row.id));

  return true;
}
