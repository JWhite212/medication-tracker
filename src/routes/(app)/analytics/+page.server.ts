import {
  getDailyDoseCounts,
  getPerMedicationStats,
  getHourlyDistribution,
  getDayOfWeekDistribution,
  calculateStreak,
  calculateTrend,
} from "$lib/server/analytics";
import type { PageServerLoad } from "./$types";

const VALID_PERIODS = new Set(["7", "30", "90", "365"]);

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const { preferences } = await parent();

  const periodParam = url.searchParams.get("period");
  const period =
    periodParam && VALID_PERIODS.has(periodParam)
      ? Number(periodParam)
      : preferences.heatmapPeriod;

  const now = Date.now();
  const previousRange = {
    from: new Date(now - period * 2 * 86400000),
    to: new Date(now - period * 86400000),
  };

  const [
    dailyCounts,
    medStats,
    hourly,
    dayOfWeek,
    prevDailyCounts,
    prevMedStats,
  ] = await Promise.all([
    getDailyDoseCounts(userId, period, timezone),
    getPerMedicationStats(userId, period),
    getHourlyDistribution(userId, period, timezone),
    getDayOfWeekDistribution(userId, period, timezone),
    getDailyDoseCounts(userId, period, timezone, previousRange),
    getPerMedicationStats(userId, period, previousRange),
  ]);

  const streak = calculateStreak(
    dailyCounts.map((d) => d.date),
    timezone,
  );

  const totalDoses = dailyCounts.reduce((a, d) => a + d.count, 0);
  const prevTotalDoses = prevDailyCounts.reduce((a, d) => a + d.count, 0);

  const avgAdherence =
    medStats.length > 0
      ? Math.round(
          medStats.reduce((a, s) => a + s.adherence, 0) / medStats.length,
        )
      : 0;
  const prevAvgAdherence =
    prevMedStats.length > 0
      ? Math.round(
          prevMedStats.reduce((a, s) => a + s.adherence, 0) /
            prevMedStats.length,
        )
      : 0;

  const trends = {
    doses: calculateTrend(totalDoses, prevTotalDoses),
    adherence: calculateTrend(avgAdherence, prevAvgAdherence),
    perMedication: medStats.map((stat) => {
      const prev = prevMedStats.find(
        (p) => p.medicationId === stat.medicationId,
      );
      return {
        medicationId: stat.medicationId,
        trend: calculateTrend(stat.adherence, prev?.adherence ?? 0),
      };
    }),
  };

  return {
    dailyCounts,
    medStats,
    hourly,
    dayOfWeek,
    streak,
    period,
    totalDoses,
    avgAdherence,
    trends,
  };
};
