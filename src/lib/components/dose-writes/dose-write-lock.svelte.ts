import { getContext, setContext } from "svelte";

/**
 * How long every dose-writing control stays locked after a write settles. A
 * double tap on Log now lands well inside this, and the second tap would
 * otherwise hit a list that has not re-rendered yet — it would write against
 * whatever row slid under the finger. Exported for tests.
 */
export const DOSE_WRITE_COOLDOWN_MS = 700;

/** Context key. Exported so a test can render a component with a lock of its own. */
export const DOSE_WRITE_LOCK = Symbol("dose-write-lock");

export interface DoseWriteLock {
  /** True while any holder (an `acquire()` write or a `hold()` undo) is active, or during the cooldown after the last one lets go. */
  readonly busy: boolean;
  /**
   * True only while a holder exists — a write or an Undo actually in flight —
   * and false during the cooldown that `busy` also covers. It separates a tap
   * refused because something is still saving (worth saying) from one that
   * merely came too soon after the last write (not worth a toast). Reactive.
   */
  readonly active: boolean;
  /** Take the lock. False when any dose write already holds it, or while it cools down. */
  acquire(): boolean;
  /**
   * Let go of an `acquire()`d hold. A no-op when this caller holds nothing.
   * The cooldown starts only once every concurrent holder (including any
   * `hold()`) has let go — otherwise a write that finishes first would free
   * the lock while a concurrent Undo is still in flight.
   */
  release(): void;
  /**
   * Take the lock unconditionally, even over an in-progress write or a
   * running cooldown — for a write that must never be refused (the toast's
   * Undo). Cancels any cooldown already counting down, so `busy` reads true
   * without interruption until a matching `extend()`. Stacks with any other
   * active holder: each `hold()` needs its own `extend()` to let go.
   */
  hold(): void;
  /**
   * Let go of a `hold()`, and — once every concurrent holder has done the
   * same — start a fresh cooldown from now, replacing whatever cooldown
   * `release()` may already have started. Pairs with `hold()`: an Undo that
   * lands while the write it is undoing is still cooling down must not let
   * that earlier cooldown's deadline decide when the shifted list is safe
   * to tap again — it needs its own full cooldown after its own reload, and
   * that cooldown must not start while another holder is still active.
   */
  extend(): void;
}

/**
 * One lock for every page under the (app) layout, which creates it once per
 * layout instance (spec D10). A write or an Undo can outlive the page that
 * started it, so the page navigated to must read the same lock. While
 * `busy`, every dose control renders `aria-disabled` and cancels its submit —
 * never the `disabled` attribute, which drops keyboard focus to <body>
 * mid-task.
 *
 * `acquire()`/`release()` and `hold()`/`extend()` are two ends of the same
 * reference count, not two independent flags: at most one `acquire()` can
 * succeed at a time (it refuses while `busy`), but `hold()` is unconditional
 * and can stack on top of an active `acquire()` — the toast Undo for an
 * earlier write is exactly that. `busy` stays true, and no cooldown starts,
 * until EVERY active holder has let go via its own `release()`/`extend()`.
 * Without that, whichever holder finishes first would start a cooldown
 * timed from its own completion, and the lock would go free mid-write for
 * whoever is still holding it.
 */
export function createDoseWriteLock(opts: { cooldownMs?: number } = {}): DoseWriteLock {
  const cooldownMs = opts.cooldownMs ?? DOSE_WRITE_COOLDOWN_MS;
  let busy = $state(false);
  /** Count of active holders (each successful `acquire()` or `hold()` call). State, so `active` is reactive. */
  let holders = $state(0);
  let cooldown: ReturnType<typeof setTimeout> | undefined;

  function clearCooldown() {
    if (cooldown === undefined) return;
    clearTimeout(cooldown);
    cooldown = undefined;
  }

  function startCooldown() {
    clearCooldown();
    cooldown = setTimeout(() => {
      cooldown = undefined;
      busy = false;
    }, cooldownMs);
  }

  /** One holder letting go. Starts the cooldown only once none remain. */
  function releaseHolder() {
    if (holders === 0) return;
    holders--;
    if (holders > 0) return;
    if (cooldown !== undefined) return;
    startCooldown();
  }

  return {
    get busy() {
      return busy;
    },
    get active() {
      return holders > 0;
    },
    acquire() {
      if (busy) return false;
      holders++;
      busy = true;
      return true;
    },
    release: releaseHolder,
    hold() {
      clearCooldown();
      holders++;
      busy = true;
    },
    extend() {
      busy = true;
      releaseHolder();
    },
  };
}

/**
 * Call once, during the (app) layout's initialisation — never at module
 * scope, which during SSR is shared by every request the process serves.
 * Tests pass `doseWriteContext()` (tests/unit/helpers/dashboard-context.ts).
 */
export function setDoseWriteLock(lock: DoseWriteLock): void {
  setContext(DOSE_WRITE_LOCK, lock);
}

/** Call during a component's initialisation. Throws when no layout set a lock. */
export function getDoseWriteLock(): DoseWriteLock {
  const lock = getContext<DoseWriteLock | undefined>(DOSE_WRITE_LOCK);
  if (!lock) {
    throw new Error(
      "No dose-write lock in context: the (app) layout must call setDoseWriteLock() (tests: doseWriteContext())",
    );
  }
  return lock;
}
