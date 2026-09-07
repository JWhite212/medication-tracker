import { error, fail } from "@sveltejs/kit";
import { desc, eq, and, gte, lt, sql, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { doseEditSchema, logFilterSchema } from "$lib/utils/validation";
import { updateDose, deleteDose } from "$lib/server/doses";
import { parseDateTimeLocal, parseDayRangeParam } from "$lib/utils/time";
import type { Actions, PageServerLoad } from "./$types";

// Escape SQL LIKE wildcards so user input doesn't accidentally match
// everything via `%` or `_`. Backslash must come first.
function escapeLikePattern(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// Bounds-check pagination so `?page=abc` or `?page=99999999` cannot produce
// a NaN offset or trigger a multi-million-row scan. Falls back to page 1.
const pageParamSchema = z.coerce.number().int().min(1).max(1000).catch(1);

export const load: PageServerLoad = async ({ locals, url, parent }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const { preferences } = await parent();
  const page = pageParamSchema.parse(url.searchParams.get("page") ?? 1);
  const limit = preferences.doseLogPageSize;
  const offset = (page - 1) * limit;
  const medFilter = url.searchParams.get("medication");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const filters = logFilterSchema.safeParse({
    status: url.searchParams.get("status") ?? "any",
    withSideEffects: url.searchParams.get("withSideEffects") ?? "false",
    q: url.searchParams.get("q") ?? undefined,
  });
  const f = filters.success
    ? filters.data
    : ({ status: "any", withSideEffects: false, q: undefined } as const);

  const conditions = [eq(doseLogs.userId, userId)];
  if (medFilter) conditions.push(eq(doseLogs.medicationId, medFilter));
  // Read as civil days in the user's zone, and `lt` against an exclusive
  // next-day bound so the whole `to` day is inside the range. `new Date(from)`
  // parsed a bare YYYY-MM-DD as UTC midnight, which both excluded the end day
  // east of UTC and, on garbage input, handed Drizzle an Invalid Date that
  // threw a RangeError out of this load — a 500 on the one set of params here
  // that was not validated.
  const fromDate = parseDayRangeParam(from, timezone, "start");
  const toDate = parseDayRangeParam(to, timezone, "end");
  if (fromDate) conditions.push(gte(doseLogs.takenAt, fromDate));
  if (toDate) conditions.push(lt(doseLogs.takenAt, toDate));
  if (f.status !== "any") conditions.push(eq(doseLogs.status, f.status));
  if (f.withSideEffects) {
    conditions.push(sql`jsonb_array_length(coalesce(${doseLogs.sideEffects}, '[]'::jsonb)) > 0`);
  }
  if (f.q) {
    conditions.push(ilike(doseLogs.notes, `%${escapeLikePattern(f.q)}%`));
  }

  const [rows, meds] = await Promise.all([
    db
      .select({
        id: doseLogs.id,
        userId: doseLogs.userId,
        medicationId: doseLogs.medicationId,
        quantity: doseLogs.quantity,
        takenAt: doseLogs.takenAt,
        loggedAt: doseLogs.loggedAt,
        updatedAt: doseLogs.updatedAt,
        notes: doseLogs.notes,
        sideEffects: doseLogs.sideEffects,
        status: doseLogs.status,
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
      .offset(offset),
    db
      .select({
        id: medications.id,
        name: medications.name,
        colour: medications.colour,
      })
      .from(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, false)))
      .orderBy(medications.name),
  ]);

  const hasMore = rows.length > limit;
  const doses = rows.slice(0, limit);

  return {
    doses,
    medications: meds,
    page,
    hasMore,
    filters: {
      medication: medFilter,
      from,
      to,
      status: f.status,
      withSideEffects: f.withSideEffects,
      q: f.q ?? "",
    },
    timezone: locals.user!.timezone,
  };
};

export const actions: Actions = {
  editDose: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const parsed = doseEditSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { editErrors: parsed.error.flatten().fieldErrors });

    const { doseId, takenAt, quantity, notes, sideEffects } = parsed.data;
    const updated = await updateDose(locals.user!.id, doseId, {
      takenAt: parseDateTimeLocal(takenAt, locals.user!.timezone),
      quantity,
      notes,
      sideEffects: sideEffects ?? null,
    });
    if (!updated) return fail(404, { editErrors: { form: ["Dose no longer exists"] } });
    return { success: true };
  },
  deleteDose: async ({ request, locals }) => {
    if (!locals.user) error(401, "Unauthorized");

    const formData = await request.formData();
    const doseId = formData.get("doseId") as string;
    if (!doseId) return fail(400, { error: "Missing dose ID" });
    const deleted = await deleteDose(locals.user!.id, doseId);
    if (!deleted) return fail(404, { error: "Dose not found" });
    return { success: true };
  },
};
