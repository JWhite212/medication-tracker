import type { DashboardPageData } from "$lib/types";
import { getActiveMedications } from "$lib/server/medications";
import { getDosesInRange, getLastDosePerMedication } from "$lib/server/doses";
import { getSchedulesForUser } from "$lib/server/schedules";
import { dashboardWindow } from "$lib/utils/schedule";
import { composeDashboardPageData } from "./page-data";

/**
 * The dashboard's reads, then its composition. I/O only: every rule lives in
 * `page-data.ts` (pure) and `utils/schedule.ts`.
 *
 * `now` is a parameter so one request uses one instant throughout: the window
 * the doses are fetched over is the window they are matched in. The page load
 * merges `getRefillForecast` in beside this. `logDoseForSlot` does not call
 * it; it recomputes one medication inside its own transaction.
 */
export async function loadDashboard(
  userId: string,
  timezone: string,
  now: Date,
): Promise<Omit<DashboardPageData, "refillForecast">> {
  const window = dashboardWindow(now, timezone);

  // dashboard-load.test.ts queues the two dose_logs reads in this order.
  const [medications, doses, lastDoses, schedulesByMedId] = await Promise.all([
    getActiveMedications(userId),
    getDosesInRange(userId, window.doseFetchFrom, window.doseFetchTo),
    getLastDosePerMedication(userId),
    getSchedulesForUser(userId),
  ]);

  return composeDashboardPageData({
    medications,
    schedulesByMedId,
    doses,
    lastDoses,
    now,
    timezone,
  });
}
