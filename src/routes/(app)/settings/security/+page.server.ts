import { fail } from "@sveltejs/kit";
import { eq, and } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users, sessions } from "$lib/server/db/schema";
import { lucia } from "$lib/server/auth/lucia";
import { passwordChangeSchema } from "$lib/utils/validation";
import { hashPassword, verifyPassword } from "$lib/server/auth/password";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const userSessions = await db
    .select({ id: sessions.id, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.userId, locals.user!.id));
  return {
    user: locals.user!,
    sessions: userSessions,
    currentSessionId: locals.session!.id,
  };
};

export const actions: Actions = {
  changePassword: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = passwordChangeSchema.safeParse(formData);
    if (!parsed.success)
      return fail(400, { passwordErrors: parsed.error.flatten().fieldErrors });

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, locals.user!.id))
      .limit(1);
    if (!user?.passwordHash)
      return fail(400, {
        passwordErrors: {
          currentPassword: ["No password set (OAuth account)"],
        },
      });

    const valid = await verifyPassword(
      user.passwordHash,
      parsed.data.currentPassword,
    );
    if (!valid)
      return fail(400, {
        passwordErrors: { currentPassword: ["Incorrect password"] },
      });

    const newHash = await hashPassword(parsed.data.newPassword);
    await db
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.id, locals.user!.id));
    await logAudit(locals.user!.id, "user", locals.user!.id, "update");
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
        .where(
          and(eq(sessions.id, sessionId), eq(sessions.userId, locals.user!.id)),
        )
        .limit(1);
      if (targetSession) {
        await lucia.invalidateSession(sessionId);
        await logAudit(locals.user!.id, "session", sessionId, "delete");
      }
    }
    return { sessionRevoked: true };
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
