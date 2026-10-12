import { invalidateAll } from "$app/navigation";
import { navigating, updated } from "$app/state";

/**
 * How long to wait after each failed reachability probe. The last value
 * repeats. After a network error `navigator.onLine` can stay true with no
 * `online` event ever coming (a reset connection, a PWA backgrounded
 * mid-request), so probing is the only way to learn the server is back.
 */
export const HEALTH_PROBE_BACKOFF_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 30_000];

/** Unauthenticated and database-free (src/routes/api/health), so it answers whenever the app can. */
const HEALTH_URL = "/api/health";

/**
 * Anything but `ok` counts as unreachable: the service worker answers a
 * failed GET with a synthetic `503 Offline`. A thrown fetch counts too.
 */
async function probe(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

function untilOnline(): Promise<void> {
  return new Promise((resolve) => {
    window.addEventListener("online", () => resolve(), { once: true });
  });
}

/**
 * Resolves after `delayMs`, or sooner on the `online` event or when the page
 * becomes visible again. Removes its listeners and its timer whichever wins.
 */
function untilRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    // `wake` reads `timer` only when it runs, which is after this line has.
    const wake = () => {
      clearTimeout(timer);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisibility);
      resolve();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    const timer = setTimeout(wake, delayMs);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisibility);
  });
}

/**
 * Resolves once the device is online AND `/api/health` answers ok. While
 * offline it only waits for the `online` event and never probes.
 *
 * Also resolves, without probing again, once `cancelled()` is true: the
 * caller's (app) session has ended (undo-registry's `watchSession`), and a
 * signed-out tab has nothing left to reload.
 */
export async function waitForServer(cancelled: () => boolean = () => false): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    while (navigator.onLine === false) await untilOnline();
    if (cancelled()) return;
    if (await probe()) return;
    await untilRetry(
      HEALTH_PROBE_BACKOFF_MS[Math.min(attempt, HEALTH_PROBE_BACKOFF_MS.length - 1)],
    );
  }
}

/**
 * Wait out a client-side navigation in flight: an `invalidateAll` issued now
 * would abort it (kit's client sets a new navigation token and the running
 * one aborts on the mismatch). An aborted navigation rejects, which is not an
 * error here. A navigation that unloads the document never settles, and there
 * is nothing left to reload after it.
 */
async function settleNavigation(): Promise<void> {
  if (navigating.to !== null && !navigating.willUnload) {
    await navigating.complete?.catch(() => {});
  }
}

/**
 * The one way a dose write refreshes the page. Nothing calls enhance's
 * `update()`: it applies a result only while the action's path matches the
 * current page, so a write posted across routes would drop its failure
 * silently, and it runs `reset_focus` on whichever page matches.
 *
 * `waitForServer` is for a write whose request failed on the network: the
 * caller keeps its lock held until this resolves, so nothing is retried
 * against data nobody has checked. Offline, it waits for the server whether
 * asked to or not, because a reload that fails offline becomes a full
 * navigation, which the service worker answers with its "Offline" page.
 *
 * `cancelled` is the caller's `watchSession()` predicate: once the session
 * that wrote has ended (a sign-out), it stops waiting and reloads nothing.
 */
export async function reloadAfterWrite(
  opts: { waitForServer?: boolean; cancelled?: () => boolean } = {},
): Promise<void> {
  const cancelled = opts.cancelled ?? (() => false);
  await settleNavigation();
  if (opts.waitForServer || navigator.onLine === false) {
    await waitForServer(cancelled);
    // The user can navigate while the server is unreachable.
    await settleNavigation();
  }
  if (cancelled()) return;
  try {
    await invalidateAll();
  } catch {
    // The data stays as it was; the next write is re-checked on the server.
  }
}

/**
 * After a 409: if version polling has seen a new deploy, reload the document
 * instead of the data. `invalidateAll` refreshes data, not JavaScript, and a
 * tab running pre-deploy code keeps posting a shape the server now refuses.
 * Returns whether it reloaded.
 */
export function reloadDocumentIfUpdated(): boolean {
  if (!updated.current) return false;
  location.reload();
  return true;
}
