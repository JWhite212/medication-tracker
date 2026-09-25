import type { DoneRow } from "$lib/types";
import type { TimeFormat } from "$lib/utils/time";
import { formatDoseLabel, toastForLog } from "$lib/utils/dashboard-copy";

/** What the log toast says when the reload cannot tell us what the matcher did. */
export interface LogToastFallback {
  label: string;
  quantity: number;
  takenAt: Date;
  todayStart: Date;
}

/**
 * The success toast for Log now and the chips, built from the RELOADED page
 * data so it states what the matcher actually did ("— counted for your 08:55,
 * 09:00 and 11:00 doses"), never what the client guessed it would do.
 *
 * `reloaded` is `page.data` (from `$app/state`) after `update()`. It is
 * `unknown` because this reads only two keys and must survive the reload
 * having failed — then it is the old payload, or not a dashboard payload at
 * all. Anything short of a Done row for `doseId` falls back to the plain
 * "logged at" sentence with no "counted for" clause.
 */
export function logToastFromReload(
  reloaded: unknown,
  doseId: string | null,
  fallback: LogToastFallback,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const data = (reloaded ?? {}) as { done?: unknown; todayStart?: unknown };
  const done = Array.isArray(data.done) ? (data.done as DoneRow[]) : [];
  const row = doseId === null ? undefined : done.find((r) => r.dose.id === doseId);
  if (!row || typeof data.todayStart !== "string") {
    return toastForLog({ ...fallback, covers: [], tz, timeFormat });
  }
  const med = row.dose.medication;
  return toastForLog({
    label: formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit),
    quantity: row.dose.quantity,
    takenAt: new Date(row.dose.takenAt),
    covers: row.covers.map((iso) => new Date(iso)),
    todayStart: new Date(data.todayStart),
    tz,
    timeFormat,
  });
}
