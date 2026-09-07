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
import { isoDayKey, shiftDayKey, wallClockToInstant } from "$lib/utils/time";
import type { Actions, PageServerLoad } from "./$types";

const SPARKLINE_DAYS = 14;
const validTimezones = new Set(Intl.supportedValuesOf("timeZone"));

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;
  const timezone = locals.user!.timezone;
  const safeTz = validTimezones.has(timezone) ? timezone : "UTC";

  // Both the window and the keys are derived from ONE anchor: today's day
  // key, stepped back in whole calendar days. Subtracting
  // `13 * 86_400_000` from an instant first — even before taking its local
  // midnight — lands a day early inside a one-hour band for the fortnight
  // after a transition, and once the key walk below became exact that error
  // stopped being absorbed by a duplicated key and propagated to the far end:
  // measured across three zones over every hour of 2026, the last bar became
  // TOMORROW (always empty) after an autumn fall-back, and stayed on
  // YESTERDAY after a spring-forward.
  const fromKey = shiftDayKey(isoDayKey(new Date(), safeTz), -(SPARKLINE_DAYS - 1));
  const sparklineFrom = wallClockToInstant(fromKey, "00:00", safeTz);
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
  // Stepped as calendar days from the same anchor as the window: a civil day
  // is not always 24 hours, so a fixed 86_400_000 step emitted the transition
  // day twice and dropped today for the fortnight after every fall-back.
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
