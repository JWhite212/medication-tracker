import {
  getDailyDoseCounts,
  getPerMedicationStats,
  getHourlyDistribution,
  getDayOfWeekDistribution,
  getSideEffectStats,
  getDailyAdherenceSeries,
  getDoseStatusBreakdown,
  getScheduleVariance,
  resolveMedicationFilter,
} from "$lib/server/analytics";
import { getSchedulesForUser } from "$lib/server/schedules";
import { getRefillForecast } from "$lib/server/inventory";
import { getMedicationOptions } from "$lib/server/medications";
import { composeAnalyticsPageData, resolveAnalyticsQuery } from "$lib/server/analytics/page-data";
import type { AnalyticsFilter } from "$lib/server/analytics";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const { preferences } = await parent();

  const { period, customRange, previousRange, fromParam, toParam } = resolveAnalyticsQuery(
    url.searchParams,
    preferences.heatmapPeriod,
  );

  const medicationOptions = await getMedicationOptions(userId);
  const medicationIds = resolveMedicationFilter(
    url.searchParams.getAll("med"),
    medicationOptions.map((m) => m.id),
  );
  const analyticsFilter: AnalyticsFilter = { ...customRange, medicationIds };

  const [
    dailyCounts,
    medStats,
    hourly,
    dayOfWeek,
    sideEffects,
    dailyAdherence,
    statusBreakdown,
    scheduleVariance,
    schedulesByMed,
    prevDailyCounts,
    prevMedStats,
  ] = await Promise.all([
    getDailyDoseCounts(userId, period, timezone, analyticsFilter),
    getPerMedicationStats(userId, period, timezone, analyticsFilter),
    getHourlyDistribution(userId, period, timezone, analyticsFilter),
    getDayOfWeekDistribution(userId, period, timezone, analyticsFilter),
    getSideEffectStats(userId, period, timezone, analyticsFilter),
    getDailyAdherenceSeries(userId, period, timezone, analyticsFilter),
    getDoseStatusBreakdown(userId, period, timezone, analyticsFilter),
    getScheduleVariance(userId, period, timezone, analyticsFilter),
    getSchedulesForUser(userId),
    getDailyDoseCounts(userId, period, timezone, { ...previousRange, medicationIds }),
    getPerMedicationStats(userId, period, timezone, { ...previousRange, medicationIds }),
  ]);

  const refillForecast = await getRefillForecast(userId);

  return composeAnalyticsPageData({
    timezone,
    period,
    fromParam,
    toParam,
    medicationIds,
    medicationOptions,
    dailyCounts,
    medStats,
    hourly,
    dayOfWeek,
    sideEffects,
    dailyAdherence,
    statusBreakdown,
    scheduleVariance,
    schedulesByMed,
    prevDailyCounts,
    prevMedStats,
    refillForecast,
  });
};
