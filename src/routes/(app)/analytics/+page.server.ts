import {
  getDailyDoseCounts,
  getPerMedicationStats,
  getHourlyDistribution,
  calculateStreak,
} from "$lib/server/analytics";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;
  const [dailyCounts, medStats, hourly] = await Promise.all([
    getDailyDoseCounts(userId, 90),
    getPerMedicationStats(userId, 30),
    getHourlyDistribution(userId, 30),
  ]);

  const streak = calculateStreak(dailyCounts.map((d) => d.date));

  return { dailyCounts, medStats, hourly, streak };
};
