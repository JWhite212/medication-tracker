import { z } from "zod";
import { buildInsights, calculateStreak, calculateTrend } from "$lib/server/analytics";
import type {
  DateRange,
  getDailyAdherenceSeries,
  getDailyDoseCounts,
  getDayOfWeekDistribution,
  getDoseStatusBreakdown,
  getHourlyDistribution,
  getPerMedicationStats,
  getScheduleVariance,
  getSideEffectStats,
} from "$lib/server/analytics";
import type { getRefillForecast } from "$lib/server/inventory";
import type { getMedicationOptions } from "$lib/server/medications";
import type { MedicationSchedule } from "$lib/server/schedules";

/**
 * Everything the analytics page computes once its data is in hand.
 *
 * The page load is I/O: it resolves the request, fires the queries and
 * hands the results here. This module owns the arithmetic between those
 * two — which is the part worth testing, and the part that was untestable
 * while it lived inside a `load`.
 */

const VALID_PERIODS = new Set(["7", "30", "90", "365"]);

// Bounds-check the optional from/to query params. Reject dates earlier than
// 2020-01-01 or later than tomorrow; on garbage input we fall through to
// `undefined` and the caller uses its default period window.
//
// The ceiling is a `refine` closure rather than `.max(new Date(...))` on
// purpose: `.max` takes its bound when the schema is constructed, which is
// once, at module import. A warm instance would carry a "tomorrow" that
// ages, and start rejecting dates that are genuinely in range. The closure
// is evaluated per parse instead.
const MIN_DATE = new Date("2020-01-01T00:00:00Z");
const MAX_FUTURE_MS = 86400000;
const dateParamSchema = z.coerce
  .date()
  .min(MIN_DATE)
  .refine((d) => d.getTime() <= Date.now() + MAX_FUTURE_MS)
  .optional()
  .catch(undefined);

export type AnalyticsQuery = {
  /** Window size in days, used whenever `customRange` is absent. */
  period: number;
  /** Set only when BOTH bounds parsed; one valid bound is not a range. */
  customRange: DateRange | undefined;
  /** The comparison window, always fully bounded. */
  previousRange: DateRange;
  /** The raw strings, echoed back so the date inputs keep their values. */
  fromParam: string | null;
  toParam: string | null;
};

/**
 * Turn the request's query string into the windows the analytics queries
 * need. `defaultPeriod` is the user's heatmapPeriod preference, used when
 * `?period=` is absent or outside the allowed set.
 */
export function resolveAnalyticsQuery(
  searchParams: URLSearchParams,
  defaultPeriod: number,
): AnalyticsQuery {
  const rawFrom = searchParams.get("from") ?? undefined;
  const rawTo = searchParams.get("to") ?? undefined;
  const fromDate = dateParamSchema.parse(rawFrom);
  const toDate = dateParamSchema.parse(rawTo);
  const fromParam = fromDate ? (rawFrom ?? null) : null;
  const toParam = toDate ? (rawTo ?? null) : null;
  // An inverted range is treated as unusable input, not silently honoured.
  // Applied, it matches no doses AND mirrors backwards into an equally
  // inverted previous window, so the page renders all-zero with every trend
  // flat — indistinguishable from "you took nothing". The raw strings are
  // still echoed so the date inputs keep what was typed, exactly as a lone
  // `from` is echoed without being applied.
  const customRange: DateRange | undefined =
    fromDate && toDate && fromDate.getTime() <= toDate.getTime()
      ? { from: fromDate, to: toDate }
      : undefined;

  const periodParam = searchParams.get("period");
  const period =
    periodParam && VALID_PERIODS.has(periodParam) ? Number(periodParam) : defaultPeriod;

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

  return { period, customRange, previousRange, fromParam, toParam };
}

type Resolved<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export type AnalyticsCompositionInputs = {
  timezone: string;
  period: number;
  fromParam: string | null;
  toParam: string | null;
  /** Undefined means "every medication", matching resolveMedicationFilter. */
  medicationIds: string[] | undefined;
  medicationOptions: Resolved<typeof getMedicationOptions>;
  dailyCounts: Resolved<typeof getDailyDoseCounts>;
  medStats: Resolved<typeof getPerMedicationStats>;
  hourly: Resolved<typeof getHourlyDistribution>;
  dayOfWeek: Resolved<typeof getDayOfWeekDistribution>;
  sideEffects: Resolved<typeof getSideEffectStats>;
  dailyAdherence: Resolved<typeof getDailyAdherenceSeries>;
  statusBreakdown: Resolved<typeof getDoseStatusBreakdown>;
  scheduleVariance: Resolved<typeof getScheduleVariance>;
  schedulesByMed: Map<string, MedicationSchedule[]>;
  prevDailyCounts: Resolved<typeof getDailyDoseCounts>;
  prevMedStats: Resolved<typeof getPerMedicationStats>;
  refillForecast: Resolved<typeof getRefillForecast>;
};

/** Build the analytics page payload from already-fetched data. */
export function composeAnalyticsPageData(input: AnalyticsCompositionInputs) {
  const {
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
  } = input;

  const relevantRefills = medicationIds
    ? refillForecast.filter((r) => medicationIds.includes(r.medicationId))
    : refillForecast;

  // Hours with at least one fixed_time schedule across the selected meds.
  //
  // Archived medications are excluded on the CURRENT `isArchived` flag, not
  // via `archivedAt`. This highlight answers "what does my schedule look
  // like", which is a question about now — unlike the expected-doses
  // denominator, which is historical and so clamps on the date instead.
  const archivedIds = new Set(medicationOptions.filter((m) => m.isArchived).map((m) => m.id));
  const scheduledHours = new Set<number>();
  for (const [medId, schedules] of schedulesByMed) {
    if (archivedIds.has(medId)) continue;
    if (medicationIds && !medicationIds.includes(medId)) continue;
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
    refillCriticalCount: relevantRefills.filter(
      (r) => r.severity === "critical" || r.severity === "warning",
    ).length,
    streak,
  });

  const trends = {
    doses: calculateTrend(totalDoses, prevTotalDoses),
    adherence: calculateTrend(avgAdherence, prevAvgAdherence),
    // A medication with no previous-window stat gets no entry at all, rather
    // than being compared against a fabricated 0 — which read as "improved
    // 100%" on every medication you had just started. AdherenceChart looks
    // its trend up by id and renders nothing when there isn't one, so an
    // absent entry is "no comparison available", which is the truth.
    perMedication: medStats.flatMap((stat) => {
      const prev = prevMedStats.find((p) => p.medicationId === stat.medicationId);
      if (!prev) return [];
      return [
        {
          medicationId: stat.medicationId,
          trend: calculateTrend(stat.adherence, prev.adherence),
        },
      ];
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
    medications: medicationOptions,
    selectedMedIds: medicationIds ?? [],
  };
}
