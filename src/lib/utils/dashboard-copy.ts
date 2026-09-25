import type { DashboardStatus, DueRow } from "$lib/types";
import { formatDuration, formatUserTime, type TimeFormat } from "./time";

/**
 * Every sentence the dashboard shows, as pure functions, so the copy is
 * unit-testable without rendering a component.
 *
 * Two rules hold across all of it:
 * - Relative time comes from the SIGN of `serverNow − expectedTime`, never
 *   from a row's state, and `serverNow` is the page's server-relative clock,
 *   never raw `Date.now()`.
 * - The word "overdue" appears nowhere. It survives only as StatusMarker's
 *   accessible name; visible copy states when, not a verdict.
 *
 * Client-reachable (dashboard components import it), so it imports only
 * `./time` and types.
 */

/** Under this the dashboard says "now" rather than "less than a minute". */
const NOW_THRESHOLD_MS = 60_000;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "now", "in 15 minutes" or "2 hours ago", from the sign of the gap. */
function relativeTo(at: Date, serverNow: Date): string {
  const diff = serverNow.getTime() - at.getTime();
  if (Math.abs(diff) < NOW_THRESHOLD_MS) return "now";
  const span = formatDuration(diff, { style: "long", maxUnits: 1 });
  return diff > 0 ? `${span} ago` : `in ${span}`;
}

/** "Metformin 500mg" — the concatenation every dose surface already uses. */
export function formatDoseLabel(name: string, dosageAmount: string, dosageUnit: string): string {
  return `${name} ${dosageAmount}${dosageUnit}`;
}

/**
 * A slot or dose time as the dashboard prints it: "22:00", or
 * "yesterday 22:00" for an instant before today's local midnight. The
 * dashboard's window never reaches further back than yesterday, so no other
 * prefix exists.
 */
export function formatSlotTime(
  at: Date,
  todayStart: Date,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const time = formatUserTime(at, tz, timeFormat);
  return at.getTime() < todayStart.getTime() ? `yesterday ${time}` : time;
}

/** A Due row's status line: "Due 11:00 · 2 hours ago", "Due 13:45 · in 15 minutes". */
export function rowStatusLine(
  row: { state: DueRow["state"]; expectedTime: Date },
  serverNow: Date,
  todayStart: Date,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const when = formatSlotTime(row.expectedTime, todayStart, tz, timeFormat);
  return `Due ${when} · ${relativeTo(row.expectedTime, serverNow)}`;
}

/** The header's status sentence and supporting line — the only place a count appears. */
export function dashboardHeaderCopy(
  status: DashboardStatus,
  serverNow: Date,
  tz: string,
  timeFormat: TimeFormat,
): { sentence: string; supporting: string | null } {
  const logged =
    status.loggedToday > 0 ? `${count(status.loggedToday, "dose")} logged today` : null;
  const progress = `${status.doneToday} of ${status.totalToday} done today`;

  switch (status.kind) {
    case "as-needed-only":
      return {
        sentence: logged ?? "No doses logged yet today",
        supporting: "Tap a medication below to log a dose.",
      };
    case "due":
      return {
        sentence: `${count(status.dueCount, "dose")} due`,
        supporting: status.doneToday > 0 ? progress : null,
      };
    case "caught-up": {
      const next = status.next;
      if (!next) return { sentence: "All caught up", supporting: null };
      const at = new Date(next.expectedTime);
      const who =
        formatDoseLabel(next.name, next.dosageAmount, next.dosageUnit) +
        (next.alsoCount > 0 ? ` and ${next.alsoCount} more` : "");
      return {
        sentence: "All caught up",
        supporting: `Next: ${who} at ${formatUserTime(at, tz, timeFormat)} · ${relativeTo(at, serverNow)}`,
      };
    }
    case "all-done":
      return { sentence: "All done for today", supporting: progress };
    case "none-today":
      return { sentence: "Nothing scheduled today", supporting: logged };
  }
}

/**
 * Log now / chip success toast, built from the reloaded data: `covers` are
 * the slots the new dose actually resolved. The Toast appends its own Undo.
 */
export function toastForLog(i: {
  label: string;
  quantity: number;
  takenAt: Date;
  covers: Date[];
  todayStart: Date;
  tz: string;
  timeFormat: TimeFormat;
}): string {
  const what = i.quantity > 1 ? `${i.label} ×${i.quantity}` : i.label;
  const logged = `${what} logged at ${formatSlotTime(i.takenAt, i.todayStart, i.tz, i.timeFormat)}`;
  if (i.covers.length === 0) return logged;
  const times = [...i.covers]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((c) => formatSlotTime(c, i.todayStart, i.tz, i.timeFormat));
  return `${logged} — counted for your ${listOf(times)} ${i.covers.length === 1 ? "dose" : "doses"}`;
}

/** "Took it at" success toast. */
export function toastForTookItAt(i: {
  label: string;
  at: Date;
  todayStart: Date;
  tz: string;
  timeFormat: TimeFormat;
}): string {
  return `${i.label} recorded as taken at ${formatSlotTime(i.at, i.todayStart, i.tz, i.timeFormat)}`;
}

/** Skip success toast. */
export function toastForSkip(i: {
  label: string;
  slot: Date;
  todayStart: Date;
  tz: string;
  timeFormat: TimeFormat;
}): string {
  return `${i.label}: ${formatSlotTime(i.slot, i.todayStart, i.tz, i.timeFormat)} dose skipped`;
}
