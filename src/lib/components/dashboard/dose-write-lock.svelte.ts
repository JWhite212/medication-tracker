import { getContext, setContext } from "svelte";

/**
 * How long every dose-writing control on the dashboard stays locked after a
 * write settles. A double tap on Log now lands well inside this, and the
 * second tap would otherwise hit a list that has not re-rendered yet — it
 * would write against whatever row slid under the finger. Exported for tests.
 */
export const DOSE_WRITE_COOLDOWN_MS = 700;

/** Context key. Exported so a test can render a component with a lock of its own. */
export const DOSE_WRITE_LOCK = Symbol("dose-write-lock");

export interface DoseWriteLock {
  /** True from a successful `acquire()` until the cooldown after `release()` ends. */
  readonly busy: boolean;
  /** Take the page-wide lock. False when any dose write already holds it. */
  acquire(): boolean;
  /** Start the cooldown. A no-op when nothing holds the lock or a cooldown is already running. */
  release(): void;
}

/**
 * One lock per dashboard. While `busy`, every DoseActionForm renders
 * `aria-disabled` and cancels its submit — never the `disabled` attribute,
 * which drops keyboard focus to <body> mid-task.
 */
export function createDoseWriteLock(opts: { cooldownMs?: number } = {}): DoseWriteLock {
  const cooldownMs = opts.cooldownMs ?? DOSE_WRITE_COOLDOWN_MS;
  let busy = $state(false);
  let cooldown: ReturnType<typeof setTimeout> | undefined;

  return {
    get busy() {
      return busy;
    },
    acquire() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      if (!busy || cooldown !== undefined) return;
      cooldown = setTimeout(() => {
        cooldown = undefined;
        busy = false;
      }, cooldownMs);
    },
  };
}

/** Call once, during +page.svelte's initialisation. */
export function setDoseWriteLock(lock: DoseWriteLock): void {
  setContext(DOSE_WRITE_LOCK, lock);
}

/** Call during a component's initialisation. Throws when no page set a lock. */
export function getDoseWriteLock(): DoseWriteLock {
  const lock = getContext<DoseWriteLock | undefined>(DOSE_WRITE_LOCK);
  if (!lock) {
    throw new Error("No dose-write lock in context: +page.svelte must call setDoseWriteLock()");
  }
  return lock;
}
