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

export function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: timezone,
  }).format(date);
}

/**
 * Parse a datetime-local input value (e.g. "2026-04-15T18:20") as a Date
 * in the given IANA timezone. datetime-local has no timezone info, so we
 * figure out the UTC offset for that wall-clock time in the user's zone.
 */
export function parseDateTimeLocal(
  datetimeLocal: string,
  timezone: string,
): Date {
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

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const tzTime = new Date(
    `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
  );
  const offsetMs = tzTime.getTime() - asUtc.getTime();
  return new Date(asUtc.getTime() - offsetMs);
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
