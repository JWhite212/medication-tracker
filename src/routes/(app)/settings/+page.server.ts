import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { settingsSchema } from "$lib/utils/validation";
import { logAudit, computeChanges } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  return { user: locals.user! };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = settingsSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    const before = { name: locals.user!.name, timezone: locals.user!.timezone };
    const after = { name: parsed.data.name, timezone: parsed.data.timezone };

    await db
      .update(users)
      .set({
        name: parsed.data.name,
        timezone: parsed.data.timezone,
        updatedAt: new Date(),
      })
      .where(eq(users.id, locals.user!.id));

    const changes = computeChanges(before, after);
    if (changes) await logAudit(locals.user!.id, "user", locals.user!.id, "update", changes);
    return {
      success: true,
      name: parsed.data.name,
      timezone: parsed.data.timezone,
    };
  },
};
