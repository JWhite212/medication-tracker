/**
 * The activity heatmap's day grid.
 *
 * Pure and separate from `Heatmap.svelte` so the timezone arithmetic is
 * unit-testable — same split as `buildSparklineShape` in `sparkline.ts`.
 *
 * Every cell carries a `date` that is BOTH a lookup key and the basis of a
 * user-facing label, which is why it lives here rather than being inlined.
 * The key half has to match the server exactly: `getDailyDoseCounts` groups
 * on `date(taken_at AT TIME ZONE <profile tz>)`, so the grid must key on the
 * same civil date in the same zone. The component previously built it from
 * `new Date()` + `setHours(0,0,0,0)` (browser-local midnight) and then read
 * it back with `toISOString()` (UTC) — for any user east of UTC those are
 * different days, so every cell looked up its neighbour's count and the whole
 * heatmap was silently off by one.
 */

export interface HeatmapDay {
  /** `YYYY-MM-DD` in the user's timezone — the server's grouping key. */
  date: string;
  /** Day of week, 0 = Sunday, matching the grid's row index. */
  row: number;
}

const ISO_DAY = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

/**
 * `days` consecutive civil dates in `timezone`, oldest first, ending today.
 *
 * The walk is anchored at **noon UTC** on today's civil date rather than at a
 * local midnight. UTC has no DST, so stepping by exactly 86_400_000 ms always
 * lands on the next calendar day; anchoring at a local midnight and stepping
 * by a fixed 24h duplicates or skips a day across a DST boundary.
 */
export function buildHeatmapDays(
  days: number,
  timezone: string,
  now: Date = new Date(),
): HeatmapDay[] {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, day] = todayKey.split("-").map(Number);
  const anchor = Date.UTC(year, month - 1, day, 12);

  const cells: HeatmapDay[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(anchor - i * 86_400_000);
    cells.push({ date: ISO_DAY.format(d), row: d.getUTCDay() });
  }
  return cells;
}
