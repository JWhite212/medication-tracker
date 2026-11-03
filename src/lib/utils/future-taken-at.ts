/**
 * The one rule for "is this dose time in the future?", shared by every door
 * that lets a client choose a dose's `takenAt`: the edit dialog's
 * `?/editDose` (`editDoseAction`) and `/api/v1`'s `log_dose` and `edit_dose`.
 *
 * It has no imports, like `utils/dose-undo.ts`, so a client file can read it
 * too.
 *
 * Imports are deliberately not a door here: see `IMPORT_FUTURE_SKEW_MS`.
 */

/**
 * The refusal. The edit dialog shows it beside Time Taken; `/api/v1` sends it
 * as the failed command's `message`, beside `FUTURE_TAKEN_AT_CODE`.
 */
export const FUTURE_TAKEN_AT_MESSAGE =
  "That time is in the future. Check the date as well as the time.";

/**
 * The failed command's `error` at `/api/v1`. A client branches on this, never
 * on the message, which is copy and may change.
 */
export const FUTURE_TAKEN_AT_CODE = "future_taken_at";

/**
 * How far past the server's clock a chosen time may sit. Times are typed from
 * the device's clock, often to the minute, so "now" on a device a little fast
 * lands just ahead; five minutes covers that without letting a wrong date
 * through.
 */
export const FUTURE_TAKEN_AT_GRACE_MS = 5 * 60_000;

/** True when `takenAt` is more than the grace past `now` (epoch ms). */
export function isFutureTakenAt(takenAt: Date, now: number): boolean {
  return takenAt.getTime() > now + FUTURE_TAKEN_AT_GRACE_MS;
}
