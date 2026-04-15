import {
  getDailyDoseCounts,
  getPerMedicationStats,
  getHourlyDistribution,
  calculateStreak,
} from "$lib/server/analytics";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, parent }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const { preferences } = await parent();
  const [dailyCounts, medStats, hourly] = await Promise.all([
    getDailyDoseCounts(userId, preferences.heatmapPeriod, timezone),
    getPerMedicationStats(userId, 30),
    getHourlyDistribution(userId, 30, timezone),
  ]);

  const streak = calculateStreak(
    dailyCounts.map((d) => d.date),
    timezone,
  );

  return { dailyCounts, medStats, hourly, streak };
};
