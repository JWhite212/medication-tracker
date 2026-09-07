import { error } from "@sveltejs/kit";
import {
  getMedicationsWithStats,
  getArchivedMedications,
  swapSortOrder,
} from "$lib/server/medications";
import { db } from "$lib/server/db";
import { doseLogs } from "$lib/server/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { getRefillForecast } from "$lib/server/inventory";
import { startOfDay, isoDayKey, shiftDayKey } from "$lib/utils/time";
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

  // Sparkline day keys, joined against `date(... AT TIME ZONE ...)` above —
  // a key, not a label, so it stays en-CA and ignores preferences.dateFormat.
  // Walked as day KEYS rather than by stepping 86_400_000 ms from a local
  // midnight: a civil day is not always 24 hours, so the fixed step
  // duplicated the transition day and dropped TODAY from the sparkline for
  // the fortnight after every autumn fall-back.
  const fromKey = isoDayKey(sparklineFrom, safeTz);
  const dayKeys: string[] = [];
  for (let i = 0; i < SPARKLINE_DAYS; i++) {
    dayKeys.push(shiftDayKey(fromKey, i));
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
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");

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
