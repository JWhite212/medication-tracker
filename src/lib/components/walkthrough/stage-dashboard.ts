// What the dashboard scenes need beyond the StageMoments themselves: the
// date format the stage renders labels in, the Done row a beat logs, the
// Undo offer's message for it, the Refills rows, and the last event the
// phone's overdue push reports. Nothing here reads a clock or the visitor's
// zone; every instant comes from a moment or from DEMO_DOSES.

import type { DateFormat, TimeFormat } from "$lib/utils/time";
import { formatDoseLabel, toastForLog } from "$lib/utils/dashboard-copy";
import { DEMO_DOSES, MEDICATIONS, WALKTHROUGH_TZ } from "./demo-data";
import type { StageDone, StageMoment } from "./demo-dashboard";

/** The default preference (`user_preferences.dateFormat`), which a new account sees. */
export const WALKTHROUGH_DATE_FORMAT: DateFormat = "DD/MM/YYYY";

/**
 * The Done row for the dose a beat logs. It throws rather than returning
 * undefined: a stage drawn from a moment that lacks its own beat dose is a
 * broken fixture, and SSR or the fidelity test should say so loudly.
 */
export function beatRow(moment: StageMoment, doseId: string): StageDone {
  const row = moment.done.find((r) => r.dose.id === doseId);
  if (!row) throw new Error(`walkthrough: no Done row for ${doseId}`);
  return row;
}

/**
 * The Undo offer's message after a beat: `toastForLog` over the AFTER
 * moment's Done row for that dose. That is exactly what Log now's
 * `logToastFromReload` builds from the reloaded page, so the offer states
 * which slots the dose actually covered ("— counted for your 8:00 dose").
 */
export function stageLogToast(moment: StageMoment, doseId: string, timeFormat: TimeFormat): string {
  const { dose, covers } = beatRow(moment, doseId);
  return toastForLog({
    label: formatDoseLabel(dose.name, dose.dosageAmount, dose.dosageUnit),
    quantity: dose.quantity,
    takenAt: dose.takenAt,
    covers: covers.map((iso) => new Date(iso)),
    todayStart: moment.todayStart,
    tz: WALKTHROUGH_TZ,
    timeFormat,
  });
}

/**
 * The Refills card's rows: each medication the demo marks `refillWatch`,
 * with its supply in days, tiered by REFILL_THRESHOLDS (`inventory.ts`);
 * walkthrough-demo-facts.test.ts holds the demo to classifyRefillSeverity.
 */
export const STAGE_REFILLS = MEDICATIONS.filter((m) => m.refillWatch).map((m) => ({
  medicationId: m.id,
  medicationName: m.name,
  colour: m.colour,
  daysUntilRefill: m.supplyDays,
  severity: "watch" as const,
}));

/**
 * A medication's latest event in DEMO_DOSES strictly before `before`, taken
 * or skipped, which is what the reminder sweep's `lastEventAt` holds, or null
 * when it has none. The phone's push banner is sent before the tap, so it
 * reads this at PHONE_NOW and never sees the dose the tap logs.
 */
export function lastEventBefore(medicationId: string, before: Date): Date | null {
  let latest: Date | null = null;
  for (const dose of DEMO_DOSES) {
    if (dose.medicationId !== medicationId) continue;
    if (dose.takenAt.getTime() >= before.getTime()) continue;
    if (latest === null || dose.takenAt.getTime() > latest.getTime()) latest = dose.takenAt;
  }
  return latest;
}
