import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { confirmReauth, reauthMessage, type ReauthPurpose } from "$lib/server/auth/reauth";
import type { DestructiveWord } from "$lib/utils/destructive-confirm";

export type { DestructiveWord } from "$lib/utils/destructive-confirm";

/**
 * The one gate on the four browser deletions nothing can undo. Its callers
 * are `settings/privacy`'s `wipeDoseHistory` and `wipeArchivedMedications`,
 * `settings/data`'s `deleteAccount`, and `settings/data/import`'s `commit` in
 * replace mode. Each calls it after its 401 check and before any write, so
 * posting the form directly skips nothing the dialog asks for.
 *
 * Every account types the word; an account with a password also enters it.
 * An account with no password (OAuth-only) passes on the word alone. Before
 * this, three of the four ran `confirmReauth` unconditionally, which can
 * never succeed without a password hash, so such an account could not run
 * them at all.
 *
 * `/api/v1` deliberately does not use this guard: its wipes still redeem a
 * password-minted reauth token and take no word. See
 * `docs/api-v1-contract.md` (`POST /auth/reauth`, and "Wipes bump the sync
 * epoch").
 */

/**
 * Whether the account has a password to confirm. A null hash and a missing
 * row both read as no password: a request with `locals.user` always has a
 * row (sessions cascade from `users`), and a missing row would delete
 * nothing anyway, since every delete is scoped by user. The guard and the
 * three page loads all ask here, so the answer has one owner.
 */
export async function accountHasPassword(userId: string): Promise<boolean> {
  const [account] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(account?.passwordHash);
}

export async function checkDestructiveGuard(
  userId: string,
  formData: FormData,
  { word, purpose }: { word: DestructiveWord; purpose: ReauthPurpose },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The word first: a refused word reads nothing and spends no reauth attempt.
  if (String(formData.get("confirmWord") ?? "").trim() !== word) {
    return { ok: false, error: `Type ${word} to confirm.` };
  }
  if (!(await accountHasPassword(userId))) return { ok: true };
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Password is required to confirm this action." };
  const reauth = await confirmReauth(userId, password, purpose);
  return reauth.ok ? { ok: true } : { ok: false, error: reauthMessage(reauth) };
}
