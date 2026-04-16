import { getMedicationsWithStats } from "$lib/server/medications";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const medications = await getMedicationsWithStats(locals.user!.id);
  return { medications };
};
