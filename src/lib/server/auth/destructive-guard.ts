import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { oauthAccounts, users } from "$lib/server/db/schema";
import { configuredWebProviders } from "$lib/server/auth/oauth";
import { confirmReauth, reauthMessage, type ReauthPurpose } from "$lib/server/auth/reauth";
import {
  RECENT_SIGN_IN_MESSAGE,
  RECENT_SIGN_IN_WINDOW_MS,
  type DestructiveConfirmation,
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

/** How far ahead of this instance's clock a sign-in stamp may be and still count. */
const CLOCK_DRIFT_MS = 60 * 1000;

/**
 * Whether a session's sign-in is recent enough for a password-less account
 * to delete. Null (every session created before `authenticated_at` existed)
 * is never recent. Strictly less than the window, so exactly ten minutes is
 * too old. A stamp up to a minute in the future counts as recent: only the
 * server writes it, so that is drift between instances' clocks. Further
 * ahead can only be a mis-stamp (a caller passing `expiresAt`, say), which
 * would otherwise read as recent for weeks, so it does not count.
 */
export function signedInRecently(authenticatedAt: Date | null, now: Date): boolean {
  if (authenticatedAt === null) return false;
  const age = now.getTime() - authenticatedAt.getTime();
  return age >= -CLOCK_DRIFT_MS && age < RECENT_SIGN_IN_WINDOW_MS;
}

/**
 * What the dialog should ask for, by the guard's own rules, so the page and
 * the gate cannot disagree. The three page loads return it. `recent` is as
 * of the load and can go stale while the page sits open; the guard's refusal
 * then tells the dialog (`RECENT_SIGN_IN_MESSAGE`). `providers` are the
 * account's linked providers that a browser can sign in with now: Apple is
 * API-only, and an unconfigured provider's link would only 503.
 */
export async function destructiveConfirmation(
  { userId, authenticatedAt }: SignedIn,
  now: Date = new Date(),
): Promise<DestructiveConfirmation> {
  if (await accountHasPassword(userId)) return { kind: "password" };
  const linked = await db
    .select({ provider: oauthAccounts.provider })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, userId));
  const names = new Set(linked.map((row) => row.provider));
  return {
    kind: "recentSignIn",
    recent: signedInRecently(authenticatedAt, now),
    providers: configuredWebProviders().filter((provider) => names.has(provider)),
  };
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
