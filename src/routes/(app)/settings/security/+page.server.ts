import { fail } from "@sveltejs/kit";
import { eq, and } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users, sessions } from "$lib/server/db/schema";
import { lucia } from "$lib/server/auth/lucia";
import { passwordChangeSchema } from "$lib/utils/validation";
import { hashPassword } from "$lib/server/auth/password";
import { confirmReauth } from "$lib/server/auth/reauth";
import {
  generateTOTPSecret,
  getTOTPUri,
  generateQRDataUrl,
  verifyAndConsumeTOTPCode,
  encryptTOTPSecret,
} from "$lib/server/auth/totp";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

async function requiresPasswordReauth(
  userId: string,
  currentPassword: string,
  purpose: "enable_2fa" | "disable_2fa",
): Promise<boolean> {
  const [account] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // OAuth-only accounts do not have a password hash. They should still
  // be able to manage 2FA using their authenticated session.
  if (!account?.passwordHash) return true;

  const reauth = await confirmReauth(userId, currentPassword, purpose);
  return reauth.ok;
}

export const load: PageServerLoad = async ({ locals }) => {
  const userSessions = await db
    .select({ id: sessions.id, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.userId, locals.user!.id));
  return {
    user: locals.user!,
    sessions: userSessions,
    currentSessionId: locals.session!.id,
    twoFactorEnabled: locals.user!.twoFactorEnabled,
  };
};

export const actions: Actions = {
  changePassword: async ({ request, locals, cookies }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = passwordChangeSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { passwordErrors: parsed.error.flatten().fieldErrors });

    const userId = locals.user!.id;
    const reauth = await confirmReauth(userId, parsed.data.currentPassword, "change_password");
    if (!reauth.ok)
      return fail(400, {
        passwordErrors: { currentPassword: ["Incorrect password"] },
      });

    const newHash = await hashPassword(parsed.data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
    await logAudit(userId, "user", userId, "update");

    // Rotate sessions: a successful password change must log out every other
    // device, but keep the current request authenticated by minting a fresh
    // session cookie.
    await lucia.invalidateUserSessions(userId);
    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    return { passwordSuccess: true };
  },
  revokeSession: async ({ request, locals }) => {
    const formData = await request.formData();
    const sessionId = formData.get("sessionId") as string;
    if (sessionId && sessionId !== locals.session!.id) {
      // Verify the target session belongs to the current user
      const [targetSession] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, locals.user!.id)))
        .limit(1);
      if (targetSession) {
        await lucia.invalidateSession(sessionId);
        await logAudit(locals.user!.id, "session", sessionId, "delete");
      }
    }
    return { sessionRevoked: true };
  },
  setupTwoFactor: async ({ request, locals }) => {
    const formData = await request.formData();
    const currentPassword = String(formData.get("currentPassword") ?? "");

    const reauthOk = await requiresPasswordReauth(locals.user!.id, currentPassword, "enable_2fa");
    if (!reauthOk)
      return fail(400, {
        totpError: "Incorrect password — re-enter to enable 2FA",
      });

    const secret = generateTOTPSecret();
    await db
      .update(users)
      .set({
        totpSecret: encryptTOTPSecret(secret),
        // Reset the replay guard for the brand-new secret. Keeping a
        // stale counter from a prior secret would, in the worst case,
        // delay first-use; clearing it here keeps the disable path's
        // counter intact so a still-valid secret never has its replay
        // guard relaxed mid-flight.
        totpLastCounter: null,
      })
      .where(eq(users.id, locals.user!.id));
    const uri = getTOTPUri(secret, locals.user!.email);
    const qrCode = await generateQRDataUrl(uri);
    return { totpSetup: { qrCode, secret } };
  },
  verifyTwoFactor: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const code = String(formData.code ?? "");
    if (code.length !== 6 || !/^\d{6}$/.test(code))
      return fail(400, { totpError: "Enter a 6-digit code" });

    // Atomic verify-and-consume — also blocks replay during enrolment.
    const ok = await verifyAndConsumeTOTPCode(locals.user!.id, code);
    if (!ok) return fail(400, { totpError: "Invalid code — try again" });

    await db
      .update(users)
      .set({ twoFactorEnabled: true, updatedAt: new Date() })
      .where(eq(users.id, locals.user!.id));
    await logAudit(locals.user!.id, "user", locals.user!.id, "update", {
      twoFactorEnabled: { from: false, to: true },
    });
    return { totpEnabled: true };
  },
  disableTwoFactor: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const code = String(formData.code ?? "");
    const currentPassword = String(formData.currentPassword ?? "");

    const reauthOk = await requiresPasswordReauth(locals.user!.id, currentPassword, "disable_2fa");
    if (!reauthOk) return fail(400, { totpError: "Incorrect password" });

    const ok = await verifyAndConsumeTOTPCode(locals.user!.id, code);
    if (!ok) return fail(400, { totpError: "Invalid code" });

    // Do NOT clear totpLastCounter here. While the secret is still
    // valid, lowering the replay guard would let a code from the same
    // step be reused. setupTwoFactor() resets it when issuing a new
    // secret, which is the only point where a fresh counter is safe.
    await db
      .update(users)
      .set({
        twoFactorEnabled: false,
        totpSecret: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, locals.user!.id));
    await logAudit(locals.user!.id, "user", locals.user!.id, "update", {
      twoFactorEnabled: { from: true, to: false },
    });
    return { totpDisabled: true };
  },
  logout: async ({ locals, cookies }) => {
    if (locals.session) {
      await logAudit(locals.user!.id, "session", locals.session.id, "delete");
      await lucia.invalidateSession(locals.session.id);
      const sessionCookie = lucia.createBlankSessionCookie();
      cookies.set(sessionCookie.name, sessionCookie.value, {
        path: ".",
        ...sessionCookie.attributes,
      });
    }
    return { loggedOut: true };
  },
};
