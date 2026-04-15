import { fail, redirect } from "@sveltejs/kit";
import { createId } from "@paralleldrive/cuid2";
import { registerSchema } from "$lib/utils/validation";
import { hashPassword } from "$lib/server/auth/password";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, "/dashboard");
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = registerSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        email: String(formData.email ?? ""),
        name: String(formData.name ?? ""),
      });
    }

    const { email, password, name } = parsed.data;

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing.length > 0) {
      return fail(400, {
        errors: { email: ["An account with this email already exists"] },
        email,
        name,
      });
    }

    const userId = createId();
    const passwordHash = await hashPassword(password);

    await db.insert(users).values({
      id: userId,
      email,
      name,
      passwordHash,
    });

    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    redirect(302, "/dashboard");
  },
};
