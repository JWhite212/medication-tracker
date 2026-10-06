import { tick } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import { applyAction } from "$app/forms";
import type { DashboardClock } from "$components/dashboard/dashboard-clock";
import { showToast } from "$components/ui/Toast.svelte";
import { actionErrorMessage } from "$lib/utils/form-errors";
import {
  OFFLINE_WRITE_TOAST,
  STALE_TAP_MESSAGE,
  STILL_SAVING_TOAST,
  SUCCESS_FALLBACK_TOAST,
  UNKNOWN_OUTCOME_TOAST,
} from "./copy";
import { getDoseWriteLock } from "./dose-write-lock.svelte";
import { focusIfLost } from "./focus-after";
import { reloadAfterWrite, reloadDocumentIfUpdated } from "./reload-after-write";
import { clearUndo, offerUndo, withdrawUndoFor, type UndoKind } from "./undo-registry.svelte";

/**
 * The ONE client path for a dose write, on every page: the dashboard's Due
 * cards, chips and Done removals (through DoseActionForm), the /log × and the
 * medications card's Log. Edit Save is the stated exception: it keeps its own
 * enhance for inline field errors, and follows the same rules by hand
 * (DoseEditForm).
 *
 * At submit, in this order, and each step can stop the write: the offline
 * gate, the layout's write lock, the dashboard's stale guard, withdrawing the
 * Undo offer for the dose being written (only now, so a refused tap never
 * deletes the user's Undo), then the request. On the result it owns the
 * reload, the toast or Undo offer, focus and the release.
 *
 * It never calls enhance's `update()`. That applies a result only while the
 * action's route is the page on screen (kit forms.js), so a failure posted
 * across routes — the card's Log posts to /dashboard from /medications — was
 * dropped silently, and its reset_focus sent focus to <body>. None of these
 * pages reads `form` for a dose action, so nothing is lost. Every reload goes
 * through reloadAfterWrite(), which waits out a navigation in flight and, when
 * it must, for the server to be reachable.
 */

export interface DoseWriteOptions {
  /** The dashboard's clock. A tap on a payload that has expired is refused and the page reloaded. Only dashboard controls pass one. */
  staleGuard?: DashboardClock;
  /**
   * Offer an Undo on success. "delete" for a create (the Undo deletes the new
   * dose), "restore" for a delete (the Undo restores it with the response's
   * `restore` handle). `focusTarget` is where focus goes once that Undo has run.
   */
  undo?: { kind: UndoKind; focusTarget: () => HTMLElement | null };
  /** The dose this write acts on. An Undo offer naming it is withdrawn once the write is sure to be sent. */
  withdrawsUndoFor?: string;
  /**
   * Called AFTER the reload, so it reads the reloaded page, with the returned
   * doseId and the time the response ARRIVED: a reload can take a while, and
   * "logged at" means when the server answered. null falls back to "Saved".
   */
  buildToast?: (doseId: string | null, respondedAt: Date) => string | null;
  /** Where focus goes after a success, and after a failure when the reload lost it. Never another dose's write button. */
  focusAfter?: () => HTMLElement | null;
  /** Marked aria-busy while the write is in flight (a Due card). */
  busyContainer?: () => HTMLElement | null;
  onSuccess?: () => void;
}

export interface DoseWrite {
  /** For `use:enhance`. */
  submit: SubmitFunction;
  /** This control's own write is in flight: show its spinner. */
  readonly pending: boolean;
  /** Any dose write holds the layout's lock, or it is cooling down: render aria-disabled. */
  readonly busy: boolean;
  /** For the write button. Enter activates on keydown and repeats; Space does neither. */
  onkeydown: (e: KeyboardEvent) => void;
}

/** What a delete or log action's success says about the dose it wrote. */
function readSuccess(data: Record<string, unknown> | undefined): {
  doseId: string | null;
  deletedAt: string | undefined;
  expiresInMs: number | undefined;
} {
  const restore = data?.restore as { deletedAt?: unknown; expiresInMs?: unknown } | undefined;
  return {
    doseId: typeof data?.doseId === "string" ? data.doseId : null,
    deletedAt: typeof restore?.deletedAt === "string" ? restore.deletedAt : undefined,
    expiresInMs: typeof restore?.expiresInMs === "number" ? restore.expiresInMs : undefined,
  };
}

/**
 * Call during a component's initialisation: it reads the (app) layout's write
 * lock from context. `getOptions` is called once per submit, and the values
 * it returns are used for the whole write: the response usually re-renders
 * the control away, and a callback must not read props of a component the
 * reload has unmounted.
 */
export function createDoseWrite(getOptions: () => DoseWriteOptions): DoseWrite {
  const lock = getDoseWriteLock();
  let pending = $state(false);

  const submit: SubmitFunction = ({ cancel }) => {
    const options = getOptions();

    // 1. Nothing can be sent: take no lock and withdraw nothing.
    if (navigator.onLine === false) {
      cancel();
      showToast(OFFLINE_WRITE_TOAST, "error");
      return;
    }

    // 2. One dose write at a time, across every page under the layout.
    if (!lock.acquire()) {
      cancel();
      // A write in flight: say so, or a refused 1–9 press looks like nothing
      // happened. A tap refused by the cooldown alone is a double tap, and
      // stays silent.
      if (lock.active) showToast(STILL_SAVING_TOAST, "error");
      return;
    }

    // 3. The dashboard's payload has expired (on the SERVER's clock). Refuse,
    // reload, and hold the lock through the reload, so nothing is tapped on
    // the old list.
    if (options.staleGuard?.isExpired()) {
      cancel();
      showToast(STALE_TAP_MESSAGE, "error");
      const release = () => lock.release();
      reloadAfterWrite().then(release, release);
      return;
    }

    // 4. The write is now sure to be sent.
    if (options.withdrawsUndoFor) withdrawUndoFor(options.withdrawsUndoFor);

    // Where focus was at the tap: the button, or whatever a 1–9 shortcut was
    // pressed from. A caller with no focusAfter (a chip) gets it back here.
    const returnFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const busyElement = options.busyContainer?.() ?? null;
    pending = true;
    busyElement?.setAttribute("aria-busy", "true");

    /** After a failure: only if the reload lost focus, never over where the user put it. */
    const refocusIfLost = () =>
      focusIfLost(
        () => options.focusAfter?.(),
        () => (returnFocus?.isConnected ? returnFocus : null),
      );

    return async ({ result }) => {
      try {
        if (result.type === "success") {
          // First, before anything can wait: the server's restore window and
          // the time a toast states both run from its answer, not from the end
          // of a reload that waited out a navigation or an unreachable server.
          const respondedAt = Date.now();
          const { doseId, deletedAt, expiresInMs } = readSuccess(result.data);
          await reloadAfterWrite();
          await tick();
          // Built from the RELOADED data, so it can say what the dose covered.
          const message =
            options.buildToast?.(doseId, new Date(respondedAt)) ?? SUCCESS_FALLBACK_TOAST;
          // Whatever offer is left belongs to an earlier write: this one replaces or ends it.
          clearUndo();
          const undo = options.undo;
          if (undo && doseId && (undo.kind === "delete" || deletedAt !== undefined)) {
            offerUndo({
              message,
              doseId,
              kind: undo.kind,
              deletedAt,
              // As the server sent it: the deadline counts from respondedAt.
              expiresInMs,
              respondedAt,
              focusTarget: undo.focusTarget,
            });
          } else {
            showToast(message, "success");
          }
          (options.focusAfter
            ? options.focusAfter()
            : returnFocus?.isConnected
              ? returnFocus
              : null
          )?.focus();
          options.onSuccess?.();
        } else if (result.type === "failure") {
          showToast(actionErrorMessage(result), "error");
          // A 409 means the button that failed is stale. A tab still running
          // pre-deploy code reloads itself instead of repeating a refused post.
          if (result.status === 409 && !reloadDocumentIfUpdated()) await reloadAfterWrite();
          refocusIfLost();
        } else if (result.type === "error") {
          if (result.status === undefined) {
            // The request never completed: the write may or may not have
            // landed. Keep the lock until the server answers and the page has
            // reloaded, so no retry acts on data nobody has checked.
            showToast(UNKNOWN_OUTCOME_TOAST, "error");
            await reloadAfterWrite({ waitForServer: true });
          } else {
            showToast(actionErrorMessage(result), "error");
            await reloadAfterWrite();
          }
          refocusIfLost();
        } else {
          await applyAction(result);
        }
      } finally {
        pending = false;
        busyElement?.removeAttribute("aria-busy");
        lock.release();
      }
    };
  };

  return {
    submit,
    get pending() {
      return pending;
    },
    get busy() {
      return lock.busy;
    },
    onkeydown(e: KeyboardEvent) {
      if (e.key === "Enter" && e.repeat) e.preventDefault();
    },
  };
}
