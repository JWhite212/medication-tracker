import {
  getMedicationsWithStats,
  getArchivedMedications,
  swapSortOrder,
} from "$lib/server/medications";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const [medications, archived] = await Promise.all([
    getMedicationsWithStats(locals.user!.id),
    getArchivedMedications(locals.user!.id),
  ]);
  return { medications, archived };
};

export const actions: Actions = {
  reorder: async ({ request, locals }) => {
    const formData = await request.formData();
    const medicationId = formData.get("medicationId") as string;
    const direction = formData.get("direction") as string;
    if (!medicationId || !direction) return;

    const meds = await getMedicationsWithStats(locals.user!.id);
    const idx = meds.findIndex((m) => m.id === medicationId);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= meds.length) return;

    await swapSortOrder(locals.user!.id, meds[idx].id, meds[swapIdx].id);
  },
};
