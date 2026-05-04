export function formatTimeSince(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return `${diffDays}d ago`;
}

export type TimeFormat = "12h" | "24h";

/**
 * Render a date in the user's timezone and preferred clock format. This
 * is the canonical formatter — pass it the user's `preferences.timeFormat`
 * everywhere a time string is shown (dashboard, timeline, history,
 * analytics, exports, email).
 */
export function formatUserTime(
  date: Date,
  timezone: string,
  timeFormat: TimeFormat = "12h",
): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat === "12h",
    timeZone: timezone,
  }).format(date);
}

/**
 * @deprecated Use formatUserTime() and pass the user's timeFormat
 * preference. Kept as a thin wrapper to avoid breaking call sites that
 * haven't been threaded with the preference yet.
 */
export function formatTime(date: Date, timezone: string): string {
  return formatUserTime(date, timezone, "12h");
}

/**
 * Parse a datetime-local input value (e.g. "2026-04-15T18:20") as a Date
 * in the given IANA timezone. datetime-local has no timezone info, so we
 * figure out the UTC offset for that wall-clock time in the user's zone.
 */
export function parseDateTimeLocal(datetimeLocal: string, timezone: string): Date {
  const asUtc = new Date(datetimeLocal + "Z");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(asUtc);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const tzTime = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
  );
  const offsetMs = tzTime.getTime() - asUtc.getTime();
  return new Date(asUtc.getTime() - offsetMs);
}

/**
 * Calculate the number of days until a medication refill is needed.
 * Returns null if inventory is not tracked or no consumption signal is available.
 *
 * For scheduled medications the schedule itself is the primary signal — a 24h
 * interval means 1 dose/day regardless of dose history, so a freshly added
 * medication with 60 doses and a 24h interval reports 60 days. PRN/as-needed
 * medications fall back to the 30-day historical average.
 */
export function calculateDaysUntilRefill(
  inventoryCount: number | null,
  avgDailyConsumption: number,
  scheduleType?: string | null,
  scheduleIntervalHours?: number | string | null,
): number | null {
  if (inventoryCount === null) return null;

  const intervalHours =
    scheduleIntervalHours !== null && scheduleIntervalHours !== undefined
      ? Number(scheduleIntervalHours)
      : NaN;
  const scheduledDaily =
    scheduleType === "scheduled" && Number.isFinite(intervalHours) && intervalHours > 0
      ? 24 / intervalHours
      : 0;

  const dailyRate = scheduledDaily > 0 ? scheduledDaily : avgDailyConsumption;
  if (dailyRate <= 0) return null;
  return Math.floor(inventoryCount / dailyRate);
}

/**
 * Format a duration in milliseconds as a human-readable "due in" string.
 * Positive ms = time until due. Negative ms = overdue. Near-zero = "Due now".
 */
export function formatDueIn(ms: number): string {
  const absMins = Math.floor(Math.abs(ms) / 60_000);
  if (absMins < 1) return "Due now";

  const hours = Math.floor(absMins / 60);
  const mins = absMins % 60;

  let label: string;
  if (hours > 0 && mins > 0) {
    label = `${hours}h ${mins}m`;
  } else if (hours > 0) {
    label = `${hours}h`;
  } else {
    label = `${mins}m`;
  }

  return ms > 0 ? `Due in ${label}` : `Overdue ${label}`;
}

/**
 * Compute the timing status for a scheduled medication.
 * @param intervalHours - the schedule interval in hours
 * @param lastEventAt   - when the medication was last *handled* — taken
 *                        OR skipped. Both advance the clock so the user
 *                        can dismiss an overdue slot by skipping it.
 *                        `null` if the schedule has never been touched.
 * @param now           - current timestamp (for testability)
 * @returns status and minutesUntilDue (negative if overdue)
 */
export function computeTimingStatus(
  intervalHours: number,
  lastEventAt: Date | null,
  now: Date = new Date(),
): {
  status: "ok" | "due_soon" | "due_now" | "overdue";
  minutesUntilDue: number;
} {
  if (!lastEventAt) {
    // Never handled — treat as overdue
    return { status: "overdue", minutesUntilDue: -1 };
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  const nextDueAt = lastEventAt.getTime() + intervalMs;
  const msUntilDue = nextDueAt - now.getTime();
  const minutesUntilDue = Math.round(msUntilDue / 60_000);

  // Thresholds: overdue if past due, due_now if within 1 min, due_soon if within 1 hour
  if (msUntilDue <= -60_000) {
    return { status: "overdue", minutesUntilDue };
  }
  if (msUntilDue <= 60_000) {
    // Within +-1 minute of due time
    return { status: "due_now", minutesUntilDue };
  }
  if (msUntilDue <= 60 * 60_000) {
    // Within 1 hour
    return { status: "due_soon", minutesUntilDue };
  }
  return { status: "ok", minutesUntilDue };
}

export function startOfDay(date: Date, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = formatter.format(date);
  // Binary search for the UTC instant that corresponds to local midnight
  // Start with UTC midnight as an estimate, then adjust using the offset
  const guess = new Date(`${dateStr}T12:00:00.000Z`);
  const offsetParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(guess);
  const lh = Number(offsetParts.find((p) => p.type === "hour")?.value ?? 0);
  const lm = Number(offsetParts.find((p) => p.type === "minute")?.value ?? 0);
  const ls = Number(offsetParts.find((p) => p.type === "second")?.value ?? 0);
  const localMs = (lh * 3600 + lm * 60 + ls) * 1000;
  return new Date(guess.getTime() - localMs);
}
