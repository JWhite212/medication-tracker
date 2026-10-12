import { showToast } from "$components/ui/Toast.svelte";
import { OFFLINE_WRITE_TOAST, STILL_SAVING_TOAST } from "./copy";
import type { DoseWriteLock } from "./dose-write-lock.svelte";

/**
 * The gate every dose write passes at submit, before anything else: the one
 * owner of "may this write start at all?". `createDoseWrite` (every dashboard
 * control, the /log × and the medications card's Log) and DoseEditForm's Save
 * (which keeps its own enhance for inline field errors) both call it, so the
 * rules below cannot drift apart between them. So does one caller that is
 * not a dose write: the medications ↑/↓ reorder, because it moves the keyed
 * cards a Log tap lands on, and a Log tapped mid-reorder could otherwise hit
 * a different medication.
 *
 * In this order, and each step refuses the write:
 *
 * 1. Offline. Nothing can be sent, and the reload afterwards would swap the
 *    page for the service worker's Offline page. Checked FIRST so an offline
 *    tap takes no lock: the toast says nothing was saved, and a lock taken
 *    here would block every dose control for the cooldown for no reason.
 * 2. The layout's write lock. `acquire()` refuses while any write holds it or
 *    it is cooling down. The "Still saving" toast is shown only while a write
 *    is actually in flight (`lock.active`): a tap refused by the cooldown
 *    alone is a double tap and stays silent.
 *
 * Returns true when the caller now HOLDS the lock and owns releasing it, in a
 * `finally`, whatever the write does next. Returns false when the write was
 * refused: `cancel()` has been called, the user has been told (unless only
 * the cooldown refused it, which stays silent), and nothing is held.
 *
 * A third rule belongs to the caller, because only it knows what it is
 * writing: withdraw the Undo offer for the dose being written
 * (`withdrawUndoFor`) only AFTER this returns true, so a refused tap never
 * costs the user their Undo. `createDoseWrite` runs its stale guard between
 * the two; that is why it is not folded in here.
 */
export function beginDoseWrite(cancel: () => void, lock: DoseWriteLock): boolean {
  if (navigator.onLine === false) {
    cancel();
    showToast(OFFLINE_WRITE_TOAST, "error");
    return false;
  }
  if (!lock.acquire()) {
    cancel();
    // Coalesced: every tap refused during one slow write says it, and the
    // live region should say it once (Toast's `coalesce`).
    if (lock.active) showToast(STILL_SAVING_TOAST, "error", { coalesce: true });
    return false;
  }
  return true;
}
