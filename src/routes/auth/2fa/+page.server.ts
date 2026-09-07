import { fail, redirect } from "@sveltejs/kit";
import { lucia } from "$lib/server/auth/lucia";
import { verifySecondFactorForLogin } from "$lib/server/auth/totp";
import { verifyPreAuthToken } from "$lib/server/api/preauth";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

/**
 * The `pending_2fa` cookie carries a SIGNED single-use claim, not a user id.
 *
 * It used to hold the raw id. `httpOnly` stops JavaScript reading a cookie;
 * it does nothing to stop an attacker SETTING one on their own request. So
 * the whole first factor could be skipped: set `pending_2fa` to a victim's
 * id, POST a valid 6-digit code, receive a full session — no password at any
 * point. That is not a break of TOTP, it is the removal of the password from
 * the pair, which makes a shoulder-surfed or phished code sufficient on its
 * own. The user id is not secret by design: `toSessionUser` ships it in the
 * profile block of every `/api/v1` export and sync response.
 *
 * The fix is not a new format. `src/lib/server/api/preauth.ts` already mints
 * exactly the right claim — HMAC-signed over the key, a `jti` for single
 * use, and a 5-minute expiry — and `/api/v1/auth/2fa` has consumed it since
 * that door was built. Two transports, one seam: bearer there, cookie here.
 */
function claimsFrom(cookies: { get(name: string): string | undefined }) {
  const token = cookies.get("pending_2fa");
  return token ? verifyPreAuthToken(token) : null;
}

export const load: PageServerLoad = async ({ cookies }) => {
  if (!claimsFrom(cookies)) redirect(302, "/auth/login");
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const claims = claimsFrom(cookies);
    if (!claims) redirect(302, "/auth/login");

    const formData = Object.fromEntries(await request.formData());
    const code = String(formData.code ?? "");

    if (code.length !== 6 || !/^\d{6}$/.test(code))
      return fail(400, { error: "Enter a 6-digit code" });

    // Wrong codes are otherwise free to guess: the TOTP step counter only
    // advances on success, so cap verification attempts per ACCOUNT.
    //
    // This key used to carry the client IP as well, which stopped anyone who
    // knew a victim's id from pre-exhausting their budget. That was the right
    // call while the cookie was forgeable — but it also meant the cap did not
    // bound the thing it exists to bound: six digits at five tries per
    // address, with addresses free, is not a cap.
    //
    // The trade, stated honestly rather than waved away. Signing the claim
    // NARROWS the lockout vector to someone who already holds the password;
    // it does not remove it. Such an attacker can still burn this bucket and
    // keep the real owner out of the 2FA step for the window. That is
    // accepted, for three reasons: per-account throttling of authenticator
    // attempts is the standing recommendation (NIST SP 800-63B §5.2.2); the
    // alternative is a full account takeover by that same attacker, which is
    // strictly worse than a delay; and `/api/v1/auth/2fa` has always keyed
    // `2fa:${userId}` with no IP component, so this unifies the two doors
    // rather than inventing an exposure. It is a 15-minute window that has to
    // be actively re-triggered — `checkRateLimit` does not extend `resetAt`
    // on a refused attempt — not a latching lock.
    const { allowed, retryAfterMs } = await enforceLimit(LIMITS.twoFactor, claims.userId);
    if (!allowed) {
      return fail(429, {
        error: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    // Atomic verify-and-consume rejects replay of the same TOTP step, and
    // the login arm additionally requires that 2FA is actually enabled —
    // an abandoned enrolment leaves a usable secret behind.
    const ok = await verifySecondFactorForLogin(claims.userId, code);
    if (!ok) return fail(400, { error: "Invalid code — try again" });

    // Burn the jti before minting anything, exactly as `/api/v1/auth/2fa`
    // does: a captured cookie cannot mint a second session inside its TTL.
    const consumeWindowMs = Math.max(claims.exp - Date.now(), 1000);
    const consumed = await enforceLimit(LIMITS.preauthBurn, claims.jti, {
      windowMs: consumeWindowMs,
    });
    if (!consumed.allowed) redirect(302, "/auth/login");

    cookies.delete("pending_2fa", { path: "/" });

    const session = await lucia.createSession(claims.userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    await logAudit(claims.userId, "session", session.id, "create");
    redirect(302, "/dashboard");
  },
};
