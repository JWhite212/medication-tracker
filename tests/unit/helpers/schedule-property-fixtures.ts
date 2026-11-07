/**
 * Seeded generation for schedule-matching property tests.
 *
 * The primitives (mulberry32, pick, int, hhmm), the zone list and the day
 * list are the ones `schedule-matching-properties.test.ts` draws from, so a
 * property written against this module covers the same DST days and zones
 * that file's differential and stability proofs do. That file keeps its own
 * copy for now: its seeds encode the draw order, and moving them is a
 * separate change.
 *
 * Fixtures are seeded, not random: a failure names its index and reproduces
 * on every run.
 */

export type Random = () => number;

/** mulberry32 — the generator walkthrough/demo-data.ts uses. */
export function mulberry32(seed: number): Random {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(random: Random, xs: readonly T[]): T {
  return xs[Math.floor(random() * xs.length)];
}

export function int(random: Random, lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

export function hhmm(minuteOfDay: number): string {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const m = String(minuteOfDay % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export const ZONES = [
  "UTC",
  "Europe/London",
  "America/New_York",
  "Pacific/Auckland",
  "Asia/Kolkata",
] as const;

/** One ordinary day, plus every DST transition the zones above have in 2026. */
export const DAYS = [
  "2026-04-16",
  "2026-03-29",
  "2026-10-25",
  "2026-11-01",
  "2026-03-08",
  "2026-04-05",
  "2026-09-27",
] as const;

/**
 * Share of drawn schedule minutes that fall in the first hour of the day,
 * so tomorrow's first hour (matched but never shown) is common.
 */
export const FIRST_HOUR_BIAS = 0.3;

/** `count` distinct minutes of the day, ascending, with the first-hour bias. */
export function scheduleMinutes(random: Random, count: number): number[] {
  const minutes = new Set<number>();
  while (minutes.size < count) {
    minutes.add(random() < FIRST_HOUR_BIAS ? int(random, 0, 59) : int(random, 0, 1439));
  }
  return [...minutes].sort((a, b) => a - b);
}
