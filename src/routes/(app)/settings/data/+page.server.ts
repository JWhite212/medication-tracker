import { error, fail, redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { dataSchema } from "$lib/utils/validation";
import { logAudit } from "$lib/server/audit";
import { lucia } from "$lib/server/auth/lucia";
import { confirmReauth, reauthMessage } from "$lib/server/auth/reauth";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const prefs = await getOrCreatePreferences(locals.user!.id);
  return { preferences: prefs };
};

export const actions: Actions = {
  updateFormat: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const parsed = dataSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    await updatePreferences(locals.user!.id, parsed.data);

    return { success: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;
    const formData = await request.formData();
    const password = String(formData.get("password") ?? "");

    if (!password) {
      return fail(400, {
        deleteError: "Password is required to delete your account.",
      });
    }

    const reauth = await confirmReauth(userId, password, "delete_account");
    if (!reauth.ok) {
      return fail(400, { deleteError: reauthMessage(reauth) });
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
