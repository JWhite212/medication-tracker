import {
  createDoseWriteLock,
  DOSE_WRITE_LOCK,
  type DoseWriteLock,
} from "$lib/components/dashboard/dose-write-lock.svelte";
import { DASHBOARD_CLOCK, type DashboardClock } from "$lib/components/dashboard/dashboard-clock";

/** A clock frozen at `now` whose payload expires an hour later unless overridden. */
export function fixedClock(now: Date, overrides: Partial<DashboardClock> = {}): DashboardClock {
  return {
    serverNow: () => now,
    nextRefreshAt: () => new Date(now.getTime() + 60 * 60 * 1000),
    refresh: async () => {},
    ...overrides,
  };
}

/** The two contexts +page.svelte sets, for `render()` / `mount()`'s `context` option. */
export function dashboardContext(
  opts: { lock?: DoseWriteLock; clock?: DashboardClock; now?: Date } = {},
): Map<unknown, unknown> {
  return new Map<unknown, unknown>([
    [DOSE_WRITE_LOCK, opts.lock ?? createDoseWriteLock()],
    [DASHBOARD_CLOCK, opts.clock ?? fixedClock(opts.now ?? new Date("2026-05-01T13:00:00.000Z"))],
  ]);
}
