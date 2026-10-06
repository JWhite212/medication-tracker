import {
  createDoseWriteLock,
  DOSE_WRITE_LOCK,
  type DoseWriteLock,
} from "$lib/components/dose-writes/dose-write-lock.svelte";
import { DASHBOARD_CLOCK, type DashboardClock } from "$lib/components/dashboard/dashboard-clock";

/** A clock frozen at `now` whose payload expires an hour later unless overridden. */
export function fixedClock(now: Date, overrides: Partial<DashboardClock> = {}): DashboardClock {
  const clock: DashboardClock = {
    serverNow: () => now,
    nextRefreshAt: () => new Date(now.getTime() + 60 * 60 * 1000),
    refresh: async () => {},
    // Derived from the two instants, so a test that overrides only
    // nextRefreshAt gets the isExpired that goes with it.
    isExpired: () => clock.serverNow().getTime() >= clock.nextRefreshAt().getTime(),
    ...overrides,
  };
  return clock;
}

/**
 * The context the (app) layout sets for every page under it: its one
 * dose-write lock. For `render()` / `mount()`'s `context` option when a test
 * renders a dose control, or a page, without the layout around it.
 */
export function doseWriteContext(
  lock: DoseWriteLock = createDoseWriteLock(),
): Map<symbol, unknown> {
  return new Map<symbol, unknown>([[DOSE_WRITE_LOCK, lock]]);
}

/** The layout's lock plus the dashboard page's clock, for `render()` / `mount()`'s `context` option. */
export function dashboardContext(
  opts: { lock?: DoseWriteLock; clock?: DashboardClock; now?: Date } = {},
): Map<unknown, unknown> {
  return new Map<unknown, unknown>([
    ...doseWriteContext(opts.lock),
    [DASHBOARD_CLOCK, opts.clock ?? fixedClock(opts.now ?? new Date("2026-05-01T13:00:00.000Z"))],
  ]);
}
