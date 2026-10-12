import { tick } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";
import { applyAction } from "$app/forms";
import type { DashboardClock } from "$components/dashboard/dashboard-clock";
import { showToast } from "$components/ui/Toast.svelte";
import { actionErrorMessage } from "$lib/utils/form-errors";
import { beginDoseWrite } from "./begin-dose-write";
import { STALE_TAP_MESSAGE, SUCCESS_FALLBACK_TOAST, UNKNOWN_OUTCOME_TOAST } from "./copy";
import { getDoseWriteLock } from "./dose-write-lock.svelte";
import { focusIfLost } from "./focus-after";
import { reloadAfterWrite, reloadDocumentIfUpdated } from "./reload-after-write";
import {
  clearUndo,
  offerUndo,
  watchSession,
  withdrawUndoFor,
  type UndoKind,
} from "./undo-registry.svelte";

/**
 * The ONE client path for a dose write, on every page: the dashboard's Due
 * cards, chips and Done removals (through DoseActionForm), the /log × and the
 * medications card's Log. Edit Save is the stated exception: it keeps its own
 * enhance for inline field errors, but starts through the same gate
 * (`beginDoseWrite`) and so cannot disagree about when a write may begin
 * (DoseEditForm).
 *
 * At submit, in this order, and each step can stop the write: the gate
 * (`beginDoseWrite`: the offline check, then the layout's write lock), the
 * dashboard's stale guard, withdrawing the Undo offer for the dose being
 * written (only now, so a refused tap never deletes the user's Undo), then the
 * request. On the result it owns the reload, the toast or Undo offer, focus
 * and the release.
 *
 * A result that lands after the (app) layout has gone — a sign-out — shows
 * nothing at all and only lets go of the lock (`watchSession`, checked when
 * the response arrives and after every await): on a shared device it would
 * otherwise put the last person's medication, and a live Undo for it, in
 * front of the next one.
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
  /**
   * Where focus goes after a result, and only when the result or its reload
   * lost it: focus the user moved elsewhere during the request is left alone.
   * Never another dose's write button.
   */
  focusAfter?: () => HTMLElement | null;
  /** Marked aria-busy while the write is in flight (a Due card). */
  busyContainer?: () => HTMLElement | null;
  /**
   * The caller's own follow-up to a success, e.g. closing the dialog the
   * control sat in. It runs after the reload, the toast and the Undo offer,
   * and BEFORE focus is judged: the primitive then waits a tick for whatever
   * it unmounted to go, so a control that onSuccess removes counts as lost
   * focus and `focusAfter` takes it. Judged before, a Remove button inside a
   * still-open dialog is connected, so nothing moved and closing the dialog
   * dropped focus to <body>.
   */
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

    // 1. The gate every dose write passes, shared with Edit Save: offline
    // (no lock taken, nothing withdrawn), then one dose write at a time across
    // every page under the layout. A refusal has already cancelled and told
    // the user.
    if (!beginDoseWrite(cancel, lock)) return;
    // Whether the (app) layout this write starts under has gone, at any
    // point from here on.
    const sessionEnded = watchSession();

    // 2. The dashboard's payload has expired (on the SERVER's clock). Refuse,
    // reload, and hold the lock through the reload, so nothing is tapped on
    // the old list.
    if (options.staleGuard?.isExpired()) {
      cancel();
      showToast(STALE_TAP_MESSAGE, "error");
      const release = () => lock.release();
      reloadAfterWrite({ cancelled: sessionEnded }).then(release, release);
      return;
    }

    // 3. The write is now sure to be sent.
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

    /**
     * After any result: only if focus was lost (on <body>, on a node the reload
     * or `onSuccess` removed, or inside the toast stack), never over where the
     * user put it. A write can take seconds on a slow connection and nothing
     * stops them working elsewhere meanwhile: typing in a search field, or
     * inside a dialog opened over the page. The caller's `focusAfter` is the
     * first choice and the control the tap came from the second.
     */
    const refocusIfLost = () =>
      focusIfLost(
        () => options.focusAfter?.(),
        () => (returnFocus?.isConnected ? returnFocus : null),
      );

    return async ({ result }) => {
      try {
        // Signed out while the request was in flight: nothing below may
        // show, and the finally still lets go of the lock.
        if (sessionEnded()) return;
        if (result.type === "success") {
          // First, before anything can wait: the server's restore window and
          // the time a toast states both run from its answer, not from the end
          // of a reload that waited out a navigation or an unreachable server.
          const respondedAt = Date.now();
          const { doseId, deletedAt, expiresInMs } = readSuccess(result.data);
          await reloadAfterWrite({ cancelled: sessionEnded });
          await tick();
          if (sessionEnded()) return;
          // Built from the RELOADED data, so it can say what the dose covered.
          const message =
            // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a value handed to buildToast, never reactive state
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
          // The caller's follow-up first, then a tick for the DOM it changes
          // (a dialog closing over the button that held focus), and only then
          // is focus judged: see `onSuccess`.
          options.onSuccess?.();
          await tick();
          if (sessionEnded()) return;
          refocusIfLost();
        } else if (result.type === "failure") {
          showToast(actionErrorMessage(result), "error");
          // Every refusal reloads before the lock goes: a 404 means the page
          // shows a dose or medication that is gone (another tab removed
          // it), and a 409 that the button itself is stale. Without the
          // reload the row stays on screen and the next tap gets the same
          // refusal. A 409 in a tab still running pre-deploy code reloads
          // the whole document instead of repeating a post the server now
          // refuses.
          if (!(result.status === 409 && reloadDocumentIfUpdated())) {
            await reloadAfterWrite({ cancelled: sessionEnded });
          }
          if (sessionEnded()) return;
          refocusIfLost();
        } else if (result.type === "error") {
          if (result.status === undefined) {
            // The request never completed: the write may or may not have
            // landed. Keep the lock until the server answers and the page has
            // reloaded, so no retry acts on data nobody has checked.
            showToast(UNKNOWN_OUTCOME_TOAST, "error");
            await reloadAfterWrite({ waitForServer: true, cancelled: sessionEnded });
          } else {
            showToast(actionErrorMessage(result), "error");
            await reloadAfterWrite({ cancelled: sessionEnded });
          }
          if (sessionEnded()) return;
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
