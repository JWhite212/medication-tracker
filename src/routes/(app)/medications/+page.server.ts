import {
  getMedicationsWithStats,
  getArchivedMedications,
  swapSortOrder,
} from "$lib/server/medications";
import { db } from "$lib/server/db";
import { doseLogs } from "$lib/server/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { getRefillForecast } from "$lib/server/inventory";
import { startOfDay } from "$lib/utils/time";
import type { Actions, PageServerLoad } from "./$types";

const SPARKLINE_DAYS = 14;
const validTimezones = new Set(Intl.supportedValuesOf("timeZone"));

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const safeTz = validTimezones.has(timezone) ? timezone : "UTC";

  const sparklineFrom = startOfDay(new Date(Date.now() - (SPARKLINE_DAYS - 1) * 86400000), safeTz);
  const tzExpr = sql.raw(`'${safeTz}'`);

  const [medications, archived, dailyRows, refillForecast] = await Promise.all([
    getMedicationsWithStats(userId),
    getArchivedMedications(userId),
    db
      .select({
        medicationId: doseLogs.medicationId,
        date: sql<string>`date(${doseLogs.takenAt} AT TIME ZONE ${tzExpr})`,
        // Sum doses, not log rows — quantity can be > 1 and the
        // sparkline should reflect total doses per day to be consistent
        // with inventory accounting (CLAUDE.md gotcha).
        count: sql<number>`coalesce(sum(${doseLogs.quantity}), 0)::int`,
      })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.status, "taken"),
          gte(doseLogs.takenAt, sparklineFrom),
        ),
      )
      .groupBy(doseLogs.medicationId, sql`date(${doseLogs.takenAt} AT TIME ZONE ${tzExpr})`),
    getRefillForecast(userId),
  ]);

  const fmtDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dayKeys: string[] = [];
  for (let i = 0; i < SPARKLINE_DAYS; i++) {
    const d = new Date(sparklineFrom.getTime() + i * 86400000);
    dayKeys.push(fmtDate.format(d));
  }

  const seriesByMed = new Map<string, Map<string, number>>();
  for (const row of dailyRows) {
    let inner = seriesByMed.get(row.medicationId);
    if (!inner) {
      inner = new Map();
      seriesByMed.set(row.medicationId, inner);
    }
    inner.set(row.date, Number(row.count));
  }

  const refillSeverityByMed = new Map(refillForecast.map((r) => [r.medicationId, r.severity]));

  const enriched = medications.map((m) => {
    const inner = seriesByMed.get(m.id);
    const sparkline = dayKeys.map((k) => inner?.get(k) ?? 0);
    return {
      ...m,
      sparkline,
      refillSeverity: refillSeverityByMed.get(m.id) ?? ("ok" as const),
    };
  });

  return { medications: enriched, archived };
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
