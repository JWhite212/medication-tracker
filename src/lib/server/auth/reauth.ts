import { createId } from "@paralleldrive/cuid2";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "$lib/server/db";
import { reauthTokens, users } from "$lib/server/db/schema";
import { verifyPassword } from "$lib/server/auth/password";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
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

/**
 * The purposes as DATA, so the `/api/v1/auth/reauth` door can enumerate
 * them into a zod enum rather than restating the union as a second list
 * that drifts.
 */
export const REAUTH_PURPOSES = [
  "change_password",
  "enable_2fa",
  "disable_2fa",
  "delete_account",
  "export_data",
  "revoke_all_sessions",
  "wipe_dose_history",
  "wipe_archived_medications",
  // Replace-mode import deletes every medication (cascading to schedules,
  // doses and inventory events) before restoring a file, so it is gated
  // like the other destructive actions.
  "import_replace_data",
] as const;

export type ReauthPurpose = (typeof REAUTH_PURPOSES)[number];

const REAUTH_TTL_MS = 5 * 60 * 1000;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * How many password confirmations one account may attempt in a window.
 *
 * Generous, because a legitimate user genuinely does fumble a password
 * across several sensitive actions — but finite, which is the point. The
 * budget is per ACCOUNT rather than per (account, purpose): a per-purpose
 * bucket would hand an attacker eight times the guesses for the cost of
 * rotating a form field.
 */
export const REAUTH_MAX_ATTEMPTS = 10;
export const REAUTH_WINDOW_MS = 15 * 60 * 1000;

export type ReauthResult = {
  ok: boolean;
  token?: string;
  /** Set when the attempt was refused without checking the password. */
  rateLimited?: boolean;
  retryAfterMs?: number;
};

/**
 * Confirm a password for a sensitive action, and bound how often that can
 * be attempted.
 *
 * The limit lives HERE rather than at the doors because there are five of
 * them — change password, enable 2FA, disable 2FA, delete account, wipe
 * data, replace-mode import — and none had one. Anyone holding a stolen or
 * borrowed session cookie could guess the account password without limit
 * and without leaving so much as a failed-login audit row. Each guess also
 * burns a full Argon2 verify, so the same endpoints doubled as a
 * CPU-exhaustion lever on a serverless budget.
 *
 * The count is taken BEFORE the verify, so a refused attempt costs no
 * Argon2 — otherwise the limiter caps the oracle but not the cost.
 *
 * There is no cross-user lockout vector to weigh against this, unlike the
 * 2FA door: reaching this function at all requires an authenticated session
 * for the account being guessed.
 */
export async function confirmReauth(
  userId: string,
  password: string,
  purpose: ReauthPurpose,
): Promise<ReauthResult> {
  const limit = await enforceLimit(LIMITS.reauth, userId);
  if (!limit.allowed) {
    return { ok: false, rateLimited: true, retryAfterMs: limit.retryAfterMs };
  }

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

/**
 * A refused attempt must not read as a wrong password: telling the user
 * their own password is wrong when the limiter turned them away is both
 * misleading and, for someone mid-recovery, alarming.
 */
export function reauthMessage(reauth: { rateLimited?: boolean; retryAfterMs?: number }): string {
  return reauth.rateLimited
    ? `Too many password attempts. Try again in ${Math.ceil((reauth.retryAfterMs ?? 0) / 60000)} minutes.`
    : "Incorrect password.";
}

/**
 * Redeem a reauth token, exactly once.
 *
 * ONE conditional UPDATE, not a SELECT followed by an UPDATE. The two-step
 * form read the row with `used_at IS NULL` and then stamped it by id, with
 * no predicate and no lock on the write — so two requests interleaving
 * between the read and the write both saw an unused token and both returned
 * true. "Single-use" is the whole property that makes one password entry
 * authorise one destructive action; under concurrency it authorised N.
 *
 * The compare-and-set is the pattern this repo already uses twice for
 * exactly this shape — `verifyAndConsumeTOTPCode`'s replay guard and
 * `claimReminderSlot`'s `setWhere` — and CLAUDE.md names it as the rule.
 * This was the odd door out.
 *
 * Correctness here is decided by Postgres, so it is tested on PGlite: a
 * fixture that captures predicates without evaluating them cannot tell a
 * conditional UPDATE from an unconditional one.
 */
export async function requireRecentReauth(
  userId: string,
  purpose: ReauthPurpose,
  rawToken: string,
): Promise<boolean> {
  const now = new Date();

  const consumed = await db
    .update(reauthTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(reauthTokens.userId, userId),
        eq(reauthTokens.purpose, purpose),
        eq(reauthTokens.tokenHash, hashToken(rawToken)),
        gt(reauthTokens.expiresAt, now),
        isNull(reauthTokens.usedAt),
      ),
    )
    .returning({ id: reauthTokens.id });

  return consumed.length === 1;
}
