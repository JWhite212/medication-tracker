import { fail } from "@sveltejs/kit";
import { desc, eq, and, gte, lte } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { doseEditSchema } from "$lib/utils/validation";
import { updateDose } from "$lib/server/doses";
import { parseDateTimeLocal } from "$lib/utils/time";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url, parent }) => {
  const userId = locals.user!.id;
  const { preferences } = await parent();
  const page = Number(url.searchParams.get("page") ?? "1");
  const limit = preferences.doseLogPageSize;
  const offset = (page - 1) * limit;
  const medFilter = url.searchParams.get("medication");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const conditions = [eq(doseLogs.userId, userId)];
  if (medFilter) conditions.push(eq(doseLogs.medicationId, medFilter));
  if (from) conditions.push(gte(doseLogs.takenAt, new Date(from)));
  if (to) conditions.push(lte(doseLogs.takenAt, new Date(to)));

  const rows = await db
    .select({
      id: doseLogs.id,
      userId: doseLogs.userId,
      medicationId: doseLogs.medicationId,
      quantity: doseLogs.quantity,
      takenAt: doseLogs.takenAt,
      loggedAt: doseLogs.loggedAt,
      notes: doseLogs.notes,
      medication: {
        name: medications.name,
        dosageAmount: medications.dosageAmount,
        dosageUnit: medications.dosageUnit,
        form: medications.form,
        colour: medications.colour,
        colourSecondary: medications.colourSecondary,
        pattern: medications.pattern,
      },
    })
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(...conditions))
    .orderBy(desc(doseLogs.takenAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const doses = rows.slice(0, limit);

  const meds = await db
    .select({
      id: medications.id,
      name: medications.name,
      colour: medications.colour,
    })
    .from(medications)
    .where(eq(medications.userId, userId))
    .orderBy(medications.name);

  return {
    doses,
    medications: meds,
    page,
    hasMore,
    filters: { medication: medFilter, from, to },
    timezone: locals.user!.timezone,
  };
};

export const actions: Actions = {
  editDose: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = doseEditSchema.safeParse(formData);
    if (!parsed.success)
      return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

    const { doseId, takenAt, quantity, notes } = parsed.data;
    await updateDose(locals.user!.id, doseId, {
      takenAt: parseDateTimeLocal(takenAt, locals.user!.timezone),
      quantity,
      notes,
    });
    return { success: true };
  },
};
