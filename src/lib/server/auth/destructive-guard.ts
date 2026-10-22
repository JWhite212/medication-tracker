import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { confirmReauth, reauthMessage, type ReauthPurpose } from "$lib/server/auth/reauth";
import {
  RECENT_SIGN_IN_MESSAGE,
  RECENT_SIGN_IN_WINDOW_MS,
  type DestructiveWord,
} from "$lib/utils/destructive-confirm";

export type { DestructiveWord } from "$lib/utils/destructive-confirm";

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

/** Who is asking: the user, and when their session's holder last signed in. */
export type SignedIn = { userId: string; authenticatedAt: Date | null };

/**
 * The asker, from a request its caller has already checked for a user (the
 * four actions' 401). A request with no session reads as never signed in,
 * so it can only fail closed.
 */
export function signedInFrom(locals: App.Locals): SignedIn {
  return { userId: locals.user!.id, authenticatedAt: locals.session?.authenticatedAt ?? null };
}

/**
 * Whether a session's sign-in is recent enough for a password-less account
 * to delete. Null (every session created before `authenticated_at` existed)
 * is never recent. Strictly less than the window, so exactly ten minutes is
 * too old. A stamp a little in the future counts as recent: only the server
 * writes it, so that is drift between instances' clocks, not an attack.
 */
export function signedInRecently(authenticatedAt: Date | null, now: Date): boolean {
  if (authenticatedAt === null) return false;
  return now.getTime() - authenticatedAt.getTime() < RECENT_SIGN_IN_WINDOW_MS;
}

/**
 * The one gate on the four browser deletions nothing can undo. Its callers
 * are `settings/privacy`'s `wipeDoseHistory` and `wipeArchivedMedications`,
 * `settings/data`'s `deleteAccount`, and `settings/data/import`'s `commit` in
 * replace mode. Each calls it after its 401 check and before any deletion, so
 * posting the form directly skips nothing the dialog asks for.
 *
 * Every account types the word; an account with a password also enters it.
 * An account with no password (OAuth-only) has nothing to enter, so it must
 * instead be using a session signed in within the last 10 minutes
 * (`RECENT_SIGN_IN_WINDOW_MS`): the word is printed on the screen, and
 * without this a stolen session cookie alone could run all four. The dialog
 * offers a provider sign-in that returns to the page. Before the guard,
 * three of the four ran `confirmReauth` unconditionally, which can never
 * succeed without a password hash, so such an account could not run them at
 * all.
 *
 * This covers these four bulk deletions and nothing else. A single dose can
 * still be removed with only a session (`/dashboard?/deleteDose`, whose Undo
 * variant keeps no trash row), on any account.
 *
 * `/api/v1` deliberately does not use this guard: its wipes still redeem a
 * password-minted reauth token and take no word. See
 * `docs/api-v1-contract.md` (`POST /auth/reauth`, and "Wipes bump the sync
 * epoch").
 */
export async function checkDestructiveGuard(
  { userId, authenticatedAt }: SignedIn,
  formData: FormData,
  {
    word,
    purpose,
    now = new Date(),
  }: { word: DestructiveWord; purpose: ReauthPurpose; now?: Date },
): Promise<{ ok: true } | { ok: false; error: string }> {
  // The word first: a refused word reads nothing and spends no reauth attempt.
  if (String(formData.get("confirmWord") ?? "").trim() !== word) {
    return { ok: false, error: `Type ${word} to confirm.` };
  }
  if (!(await accountHasPassword(userId))) {
    return signedInRecently(authenticatedAt, now)
      ? { ok: true }
      : { ok: false, error: RECENT_SIGN_IN_MESSAGE };
  }
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Password is required to confirm this action." };
  const reauth = await confirmReauth(userId, password, purpose);
  return reauth.ok ? { ok: true } : { ok: false, error: reauthMessage(reauth) };
}
