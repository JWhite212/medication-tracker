<script lang="ts" module>
  import { browser } from "$app/environment";

  type ToastItem = {
    id: string;
    message: string;
    type: "success" | "error";
    undoAction?: () => void;
  };

  /**
   * Module-level state, so EXACTLY ONE <Toast /> may be mounted — it now
   * lives in (app)/+layout.svelte. Mount a second and every toast renders
   * twice in two aria-live regions, and screen readers announce it twice.
   *
   * The `browser` guard exists because the layout mount means this module is
   * evaluated during SSR on every authenticated page. Module state is
   * per-process on the server, so a showToast() reached during SSR would be
   * visible to whichever user rendered next.
   */
  let toasts = $state<ToastItem[]>([]);

  export function showToast(
    message: string,
    type: "success" | "error" = "success",
    undoAction?: () => void,
  ) {
    if (!browser) return;
    const id = crypto.randomUUID();
    toasts.push({ id, message, type, undoAction });
    scheduleDismiss(id);
  }

  export function dismissToast(id: string) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    toasts = toasts.filter((t) => t.id !== id);
  }

  /**
   * Remove every plain toast and stop its timer. The (app) layout calls this,
   * with resetUndoRegistry(), when it unmounts: signing out leaves (app), and
   * on a shared device the next person to sign in must not read what the
   * last one was told. A no-op during SSR, like showToast.
   */
  export function clearToasts(): void {
    if (!browser) return;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    toasts = [];
    pointerInside = false;
    focusInside = false;
  }

  const DISMISS_MS = 5000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Start or restart the automatic dismissal timer for a toast. */
  function scheduleDismiss(id: string) {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        toasts = toasts.filter((t) => t.id !== id);
      }, DISMISS_MS),
    );
  }

  /**
   * WCAG 2.2.1: a five-second auto-dismiss is a time limit, and the Undo here is
   * the ONLY way back from a logged or deleted dose. Reaching it by keyboard
   * means tabbing past the whole page — comfortably more than five seconds — so
   * hovering or focusing the stack holds it open.
   *
   * Pointer and focus are tracked separately because either one alone is reason
   * to keep holding it. A single pause/resume pair let them overwrite each
   * other: moving the pointer away while an Undo button was focused resumed
   * every timer, and five seconds later the focused toast — and the only route
   * back from a logged or deleted dose — vanished from under the keyboard. The
   * inverse held too, focus leaving while the pointer still hovered.
   *
   * Resuming restarts the full interval rather than the remainder. That is
   * deliberate: it errs towards giving the user more time, never less.
   *
   * The registry's Undo offer is not one of these toasts and has no 5s timer:
   * it stays until it is used, dismissed, replaced or withdrawn, capped by its
   * own deadline (dose-writes/undo-registry.svelte.ts).
   */
  let pointerInside = false;
  let focusInside = false;

  /** Hold or restart dismissal to match the current pointer and focus state. */
  function updateDismissal() {
    if (pointerInside || focusInside) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      return;
    }
    for (const toast of toasts) scheduleDismiss(toast.id);
  }

  /** Record whether the pointer is currently over the toast stack. */
  function setPointerInside(inside: boolean) {
    pointerInside = inside;
    updateDismissal();
  }

  /** Record whether focus is currently inside the toast stack. */
  function setFocusInside(inside: boolean) {
    focusInside = inside;
    updateDismissal();
  }
</script>

<script lang="ts">
  import { STILL_SAVING_TOAST } from "$components/dose-writes/copy";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import {
    currentUndo,
    dismissUndo,
    rememberFocusBeforeStack,
    runUndo,
  } from "$components/dose-writes/undo-registry.svelte";

  /**
   * The (app) layout's write lock. Context can only be read while a component
   * initialises, so it is read here; Toast is mounted once, in that layout, and
   * lives exactly as long as it, so this IS the lock every page under the
   * layout reads. Offers never carry a lock: an Undo pressed after navigating
   * holds the lock the page now on screen reads.
   */
  const lock = getDoseWriteLock();
  const offer = $derived(currentUndo());

  async function pressUndo(): Promise<void> {
    // A second press while the first runs does nothing at all — not even
    // "Still saving…", which would describe this Undo as someone else's write.
    const current = currentUndo();
    if (!current || current.running) return;
    const outcome = await runUndo(lock);
    if (outcome.kind === "settled") showToast(outcome.message, outcome.type);
    else if (outcome.kind === "refused" && lock.active) showToast(STILL_SAVING_TOAST, "error");
  }

  /** Remember where focus came from, so an Undo can hand it back there. */
  function onStackFocusIn(e: FocusEvent & { currentTarget: EventTarget & HTMLDivElement }) {
    const from = e.relatedTarget;
    if (!e.currentTarget.contains(from as Node | null)) {
      rememberFocusBeforeStack(from instanceof HTMLElement ? from : null);
    }
    setFocusInside(true);
  }
</script>

<!-- This container IS the live region. The toasts inside previously each carried
     role="alert" as well, nesting an assertive region inside a polite one: the
     inner role won and interrupted whatever was being read. Successes and
     failures both come through here, so polite is the right register.
     data-toast-stack: focus inside it counts as lost (focus-after.ts), so an
     Undo moves it back to the page before its button goes. -->
<div
  class="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
  role="status"
  aria-live="polite"
  aria-atomic="false"
  data-toast-stack
  onmouseenter={() => setPointerInside(true)}
  onmouseleave={() => setPointerInside(false)}
  onfocusin={onStackFocusIn}
  onfocusout={(e) => {
    // focusout also fires moving BETWEEN controls inside the stack, so treat it
    // as leaving only when focus lands outside the container. contains(null) is
    // false, so focus lost to nothing still counts as leaving.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFocusInside(false);
  }}
>
  {#if offer}
    <!-- The ONE Undo offer. Undo's accessible name is its word plus the
         message, through aria-labelledby ("Undo Dose removed: …"), so the
         live region holds nothing extra and nothing is announced twice. Both
         buttons are 44px, like every other dose control. -->
    <div
      data-undo-offer
      class="border-success/30 bg-success/10 text-success flex max-w-sm flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl"
    >
      <span id="undo-message-{offer.id}" class="min-w-0 flex-1 text-sm">{offer.message}</span>
      <button
        type="button"
        class="min-h-11 px-3 text-sm font-medium underline aria-disabled:cursor-not-allowed"
        aria-labelledby="undo-word-{offer.id} undo-message-{offer.id}"
        aria-disabled={offer.running ? "true" : undefined}
        onclick={pressUndo}
        ><span id="undo-word-{offer.id}">{offer.running ? "Undoing…" : "Undo"}</span></button
      >
      <button
        type="button"
        class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-base aria-disabled:cursor-not-allowed"
        aria-label="Dismiss"
        aria-disabled={offer.running ? "true" : undefined}
        onclick={dismissUndo}><span aria-hidden="true">×</span></button
      >
      {#if offer.note}
        <p class="basis-full text-sm">{offer.note}</p>
      {/if}
    </div>
  {/if}
  {#each toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl {toast.type ===
      'success'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger-ink/30 bg-danger/10 text-danger-ink'}"
    >
      <span class="text-sm">{toast.message}</span>
      {#if toast.undoAction}
        <!-- min-h-11 px-3: Undo is the only one-tap route back from a logged
             dose and must meet the 44px target every dose control does. -->
        <button
          class="min-h-11 px-3 text-sm font-medium underline"
          onclick={() => {
            toast.undoAction?.();
            dismissToast(toast.id);
          }}
        >
          Undo
        </button>
      {/if}
    </div>
  {/each}
</div>
