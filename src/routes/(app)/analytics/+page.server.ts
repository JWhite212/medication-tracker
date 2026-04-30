import { z } from "zod";
import {
  getDailyDoseCounts,
  getPerMedicationStats,
  getHourlyDistribution,
  getDayOfWeekDistribution,
  getSideEffectStats,
  getDailyAdherenceSeries,
  getDoseStatusBreakdown,
  getScheduleVariance,
  buildInsights,
  calculateStreak,
  calculateTrend,
} from "$lib/server/analytics";
import { getSchedulesForUser } from "$lib/server/schedules";
import { getRefillForecast } from "$lib/server/inventory";
import type { DateRange } from "$lib/server/analytics";
import type { PageServerLoad } from "./$types";

const VALID_PERIODS = new Set(["7", "30", "90", "365"]);

// Bounds-check the optional from/to query params. Reject dates earlier than
// 2020-01-01 or later than now+1day; on garbage input we fall through to
// `undefined` and the load function uses its default 30-day window.
const MIN_DATE = new Date("2020-01-01T00:00:00Z");
const dateParamSchema = z.coerce
  .date()
  .min(MIN_DATE)
  .max(new Date(Date.now() + 86400000))
  .optional()
  .catch(undefined);

export const load: PageServerLoad = async ({ locals, parent, url }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const { preferences } = await parent();

  const rawFrom = url.searchParams.get("from") ?? undefined;
  const rawTo = url.searchParams.get("to") ?? undefined;
  const fromDate = dateParamSchema.parse(rawFrom);
  const toDate = dateParamSchema.parse(rawTo);
  const fromParam = fromDate ? (rawFrom ?? null) : null;
  const toParam = toDate ? (rawTo ?? null) : null;
  const customRange: DateRange | undefined =
    fromDate && toDate ? { from: fromDate, to: toDate } : undefined;

  const periodParam = url.searchParams.get("period");
  const period =
    periodParam && VALID_PERIODS.has(periodParam) ? Number(periodParam) : preferences.heatmapPeriod;

  const now = Date.now();
  const previousRange: DateRange = customRange
    ? {
        from: new Date(
          customRange.from!.getTime() - (customRange.to!.getTime() - customRange.from!.getTime()),
        ),
        to: customRange.from!,
      }
    : {
        from: new Date(now - period * 2 * 86400000),
        to: new Date(now - period * 86400000),
      };

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
    getDailyDoseCounts(userId, period, timezone, customRange),
    getPerMedicationStats(userId, period, timezone, customRange),
    getHourlyDistribution(userId, period, timezone, customRange),
    getDayOfWeekDistribution(userId, period, timezone, customRange),
    getSideEffectStats(userId, period, timezone, customRange),
    getDailyAdherenceSeries(userId, period, timezone, customRange),
    getDoseStatusBreakdown(userId, period, timezone, customRange),
    getScheduleVariance(userId, period, timezone, customRange),
    getSchedulesForUser(userId),
    getDailyDoseCounts(userId, period, timezone, previousRange),
    getPerMedicationStats(userId, period, timezone, previousRange),
  ]);

  const refillForecast = await getRefillForecast(userId);

  // Hours with at least one fixed_time schedule across all meds.
  const scheduledHours = new Set<number>();
  for (const schedules of schedulesByMed.values()) {
    for (const s of schedules) {
      if (s.scheduleKind === "fixed_time" && s.timeOfDay) {
        const hour = Number(s.timeOfDay.split(":")[0]);
        if (Number.isFinite(hour)) scheduledHours.add(hour);
      }
    }
  }

  const streak = calculateStreak(
    dailyCounts.map((d) => d.date),
    timezone,
  );

  const totalDoses = dailyCounts.reduce((a, d) => a + d.count, 0);
  const prevTotalDoses = prevDailyCounts.reduce((a, d) => a + d.count, 0);

  const avgAdherence =
    medStats.length > 0
      ? Math.round(medStats.reduce((a, s) => a + s.adherence, 0) / medStats.length)
      : 0;
  const prevAvgAdherence =
    prevMedStats.length > 0
      ? Math.round(prevMedStats.reduce((a, s) => a + s.adherence, 0) / prevMedStats.length)
      : 0;

  const insights = buildInsights({
    totalDoses,
    prevTotalDoses,
    avgAdherence,
    prevAvgAdherence,
    medStats: medStats.map((s) => ({
      medicationName: s.medicationName,
      adherence: s.adherence,
      expectedTotal: s.expectedTotal,
    })),
    dayOfWeek,
    hourly,
    sideEffectsCount: sideEffects.frequency.reduce((s, e) => s + e.count, 0),
    topSideEffect: sideEffects.frequency[0]?.name ?? null,
    refillCriticalCount: refillForecast.filter(
      (r) => r.severity === "critical" || r.severity === "warning",
    ).length,
    streak,
  });

  const trends = {
    doses: calculateTrend(totalDoses, prevTotalDoses),
    adherence: calculateTrend(avgAdherence, prevAvgAdherence),
    perMedication: medStats.map((stat) => {
      const prev = prevMedStats.find((p) => p.medicationId === stat.medicationId);
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
    sideEffects,
    dailyAdherence,
    statusBreakdown,
    scheduleVariance,
    scheduledHours: [...scheduledHours].sort((a, b) => a - b),
    insights,
    streak,
    period,
    totalDoses,
    avgAdherence,
    trends,
    from: fromParam ?? "",
    to: toParam ?? "",
  };
};
