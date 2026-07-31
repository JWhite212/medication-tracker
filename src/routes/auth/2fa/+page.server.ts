import { fail, redirect } from "@sveltejs/kit";
import { lucia } from "$lib/server/auth/lucia";
import { verifyAndConsumeTOTPCode } from "$lib/server/auth/totp";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const pendingUserId = cookies.get("pending_2fa");
  if (!pendingUserId) redirect(302, "/auth/login");
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const pendingUserId = cookies.get("pending_2fa");
    if (!pendingUserId) redirect(302, "/auth/login");

    const formData = Object.fromEntries(await request.formData());
    const code = String(formData.code ?? "");

    if (code.length !== 6 || !/^\d{6}$/.test(code))
      return fail(400, { error: "Enter a 6-digit code" });

    // Wrong codes are otherwise free to guess: the TOTP step counter
    // only advances on success, so cap verification attempts. The key
    // is scoped by client IP as well as the pending user id: the
    // pending_2fa cookie is unauthenticated and forgeable, so keying on
    // the user id alone would let anyone who knows a victim's id
    // pre-exhaust (lock out) their 2FA budget. Scoping by IP means an
    // attacker only burns their own bucket, and it no longer shares a
    // key with the API 2FA path.
    const { allowed, retryAfterMs } = await checkRateLimit(
      `2fa:${pendingUserId}:${getClientAddress()}`,
      5,
      15 * 60 * 1000,
    );
    if (!allowed) {
      return fail(429, {
        error: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    // Atomic verify-and-consume rejects replay of the same TOTP step.
    const ok = await verifyAndConsumeTOTPCode(pendingUserId, code);
    if (!ok) return fail(400, { error: "Invalid code — try again" });

    cookies.delete("pending_2fa", { path: "/" });

    const session = await lucia.createSession(pendingUserId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    await logAudit(pendingUserId, "session", session.id, "create");
    redirect(302, "/dashboard");
  },
};
