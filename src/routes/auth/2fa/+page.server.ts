import { fail, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { lucia } from "$lib/server/auth/lucia";
import { verifyTOTPCode } from "$lib/server/auth/totp";
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

    const [user] = await db
      .select({ id: users.id, totpSecret: users.totpSecret })
      .from(users)
      .where(eq(users.id, pendingUserId))
      .limit(1);

    if (!user?.totpSecret || !verifyTOTPCode(user.totpSecret, code))
      return fail(400, { error: "Invalid code — try again" });

    // Clear the pending cookie
    cookies.delete("pending_2fa", { path: "/" });

    // Create session
    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    await logAudit(user.id, "session", session.id, "create");
    redirect(302, "/dashboard");
  },
};
