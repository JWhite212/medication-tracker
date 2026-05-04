import { fail, redirect } from "@sveltejs/kit";
import { lucia } from "$lib/server/auth/lucia";
import { verifyAndConsumeTOTPCode } from "$lib/server/auth/totp";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ cookies }) => {
  const pendingUserId = cookies.get("pending_2fa");
  if (!pendingUserId) redirect(302, "/auth/login");
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const pendingUserId = cookies.get("pending_2fa");
    if (!pendingUserId) redirect(302, "/auth/login");

    const formData = Object.fromEntries(await request.formData());
    const code = String(formData.code ?? "");

    if (code.length !== 6 || !/^\d{6}$/.test(code))
      return fail(400, { error: "Enter a 6-digit code" });

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
