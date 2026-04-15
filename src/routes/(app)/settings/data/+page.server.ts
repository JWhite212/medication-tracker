import { fail, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import {
  getOrCreatePreferences,
  updatePreferences,
} from "$lib/server/preferences";
import { dataSchema } from "$lib/utils/validation";
import { logAudit, computeChanges } from "$lib/server/audit";
import { lucia } from "$lib/server/auth/lucia";
import { verifyPassword } from "$lib/server/auth/password";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const prefs = await getOrCreatePreferences(locals.user!.id);
  return { preferences: prefs };
};

export const actions: Actions = {
  updateFormat: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = dataSchema.safeParse(formData);
    if (!parsed.success)
      return fail(400, { errors: parsed.error.flatten().fieldErrors });

    const before = await getOrCreatePreferences(locals.user!.id);
    const updated = await updatePreferences(locals.user!.id, parsed.data);

    const changes = computeChanges(
      { exportFormat: before.exportFormat },
      { exportFormat: updated.exportFormat },
    );
    if (changes)
      await logAudit(
        locals.user!.id,
        "user_preferences",
        locals.user!.id,
        "update",
        changes,
      );

    return { success: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    const userId = locals.user!.id;
    const formData = await request.formData();
    const password = String(formData.get("password") ?? "");

    if (!password) {
      return fail(400, {
        deleteError: "Password is required to delete your account.",
      });
    }

    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (
      !user?.passwordHash ||
      !(await verifyPassword(user.passwordHash, password))
    ) {
      return fail(400, { deleteError: "Incorrect password." });
    }

    await logAudit(userId, "user", userId, "delete");
    await lucia.invalidateUserSessions(userId);
    await db.delete(users).where(eq(users.id, userId));
    const sessionCookie = lucia.createBlankSessionCookie();
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
    redirect(302, "/");
  },
};
