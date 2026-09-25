import { getContext, setContext } from "svelte";

/** Context key. Exported so a test can render a component with a clock of its own. */
export const DASHBOARD_CLOCK = Symbol("dashboard-clock");

/**
 * Server time minus device time, measured when a payload arrives.
 *
 * Every payload instant (`now`, `nextRefreshAt`, slot times) is on the
 * server's clock. Compare one with raw `Date.now()` on a device ten minutes
 * fast and the page reloads in a loop — each reload hands back a
 * `nextRefreshAt` the device already believes has passed — and the stale
 * guard refuses every tap near a boundary.
 */
export function skewFrom(serverNowIso: string, clientNowMs: number = Date.now()): number {
  return Date.parse(serverNowIso) - clientNowMs;
}

export interface DashboardClock {
  /** The current instant on the server's clock. */
  serverNow(): Date;
  /** When the loaded payload stops being true, on the server's clock. */
  nextRefreshAt(): Date;
  /** Reload the page data now. Overlapping calls share one reload. */
  refresh(): Promise<void>;
}

export interface DashboardClockPayload {
  now: string;
  nextRefreshAt: string;
}

export interface DashboardClockController extends DashboardClock {
  /** Adopt a freshly loaded payload: re-measure skew and re-arm the one refresh timer. Call once per payload. */
  sync(payload: DashboardClockPayload): void;
  /** For `visibilitychange` → visible: reload if the payload expired while the tab was hidden. */
  onVisible(): void;
  /** For the window's `online` event: run a refresh that came due while offline. */
  onOnline(): void;
  /** Clear the refresh timer. */
  dispose(): void;
}

export function createDashboardClock(invalidate: () => Promise<void>): DashboardClockController {
  let skewMs = 0;
  let refreshAtMs = Number.NaN;
  let firedFor: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;

  const serverNowMs = () => Date.now() + skewMs;

  function refresh(): Promise<void> {
    inFlight ??= invalidate().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /**
   * Reload at most once per payload, only once the SERVER's clock says it has
   * expired, and never while offline. A reload whose data request fails does
   * not leave the page as it was: SvelteKit falls back to a full navigation,
   * which the service worker answers with its plain "Offline" page. A refresh
   * skipped offline stays pending, and `onOnline` runs it.
   */
  function refreshIfExpired(): void {
    if (!(serverNowMs() >= refreshAtMs) || firedFor === refreshAtMs) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    firedFor = refreshAtMs;
    void refresh().catch(() => {});
  }

  function arm(): void {
    clearTimeout(timer);
    timer = undefined;
    if (Number.isNaN(refreshAtMs)) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        // A timer measures elapsed time, and the device clock can be stepped
        // underneath it. If the server clock has not reached the refresh yet,
        // wait out the difference rather than dropping the refresh.
        if (serverNowMs() < refreshAtMs) arm();
        else refreshIfExpired();
      },
      Math.max(0, refreshAtMs - serverNowMs()),
    );
  }

  return {
    serverNow: () => new Date(serverNowMs()),
    nextRefreshAt: () => new Date(refreshAtMs),
    refresh,
    sync(payload) {
      skewMs = skewFrom(payload.now);
      refreshAtMs = Date.parse(payload.nextRefreshAt);
      arm();
    },
    onVisible: refreshIfExpired,
    onOnline: refreshIfExpired,
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Call once, during +page.svelte's initialisation. */
export function setDashboardClock(c: DashboardClock): void {
  setContext(DASHBOARD_CLOCK, c);
}

/** Call during a component's initialisation. Throws when no page set a clock. */
export function getDashboardClock(): DashboardClock {
  const clock = getContext<DashboardClock | undefined>(DASHBOARD_CLOCK);
  if (!clock) {
    throw new Error("No dashboard clock in context: +page.svelte must call setDashboardClock()");
  }
  return clock;
}
