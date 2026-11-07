import { fail, redirect, error } from "@sveltejs/kit";
import { z } from "zod";
import { parseMedicationForm } from "$lib/server/medication-form";
import {
  getMedicationById,
  updateMedicationWithSchedules,
  archiveMedication,
  unarchiveMedication,
} from "$lib/server/medications";
import { getSchedulesForMedication } from "$lib/server/schedules";
import {
  getInventoryHistory,
  refillMedication,
  adjustInventory,
  InvalidRefillQuantityError,
  InvalidAdjustmentError,
  MedicationNotFoundError,
} from "$lib/server/inventory-events";
import type { Actions, PageServerLoad } from "./$types";

const refillSchema = z.object({
  quantity: z.coerce.number().int().positive().max(100_000),
  note: z.string().max(200).optional().or(z.literal("")),
});

const adjustSchema = z.object({
  newCount: z.coerce.number().int().min(0).max(100_000),
  note: z.string().max(200).optional().or(z.literal("")),
});

export const load: PageServerLoad = async ({ locals, params }) => {
  const userId = locals.user!.id;
  const medication = await getMedicationById(userId, params.id);
  if (!medication) error(404, "Medication not found");
  const schedules = await getSchedulesForMedication(params.id, userId);
  const inventoryHistory = await getInventoryHistory(userId, params.id);
  return { medication, schedules, inventoryHistory };
};

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const form = parseMedicationForm(formData);
    if (!form.ok) return form.failure;

    const result = await updateMedicationWithSchedules(
      locals.user!.id,
      params.id,
      form.medication,
      form.schedules,
    );
    if (!result) error(404, "Medication not found");
    redirect(302, "/medications");
  },
  archive: async ({ locals, params }) => {
    if (!locals.user) error(401, "Unauthorized");
    await archiveMedication(locals.user.id, params.id);
    redirect(302, "/medications");
  },
  unarchive: async ({ locals, params }) => {
    if (!locals.user) error(401, "Unauthorized");
    await unarchiveMedication(locals.user.id, params.id);
    redirect(302, "/medications");
  },
  refill: async ({ request, locals, params }) => {
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const parsed = refillSchema.safeParse(formData);
    if (!parsed.success) {
      return fail(400, { refillError: "Quantity must be a positive whole number." });
    }
    try {
      const { newCount } = await refillMedication(
        locals.user!.id,
        params.id,
        parsed.data.quantity,
        parsed.data.note || null,
      );
      return { refillOk: true, newCount };
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { refillError: "Medication not found." });
      }
      if (err instanceof InvalidRefillQuantityError) {
        return fail(400, { refillError: "Quantity must be a positive whole number." });
      }
      throw err;
    }
  },
  adjust: async ({ request, locals, params }) => {
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const parsed = adjustSchema.safeParse(formData);
    if (!parsed.success) {
      return fail(400, { adjustError: "New count must be a whole number, 0 or greater." });
    }
    try {
      const { newCount, quantityChange } = await adjustInventory(
        locals.user!.id,
        params.id,
        parsed.data.newCount,
        parsed.data.note || null,
      );
      return { adjustOk: true, newCount, quantityChange };
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { adjustError: "Medication not found." });
      }
      if (err instanceof InvalidAdjustmentError) {
        return fail(400, { adjustError: err.message });
      }
      throw err;
    }
  },
};
