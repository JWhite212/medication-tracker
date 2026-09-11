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

  const DISMISS_MS = 5000;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

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
   * hovering or focusing the stack holds it open until the pointer or focus
   * leaves.
   */
  function pauseDismissal() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  function resumeDismissal() {
    for (const toast of toasts) scheduleDismiss(toast.id);
  }
</script>

<!-- This container IS the live region. The toasts inside previously each carried
     role="alert" as well, nesting an assertive region inside a polite one: the
     inner role won and interrupted whatever was being read. Successes and
     failures both come through here, so polite is the right register. -->
<div
  class="fixed right-4 bottom-4 z-50 flex flex-col gap-2"
  role="status"
  aria-live="polite"
  aria-atomic="false"
  onmouseenter={pauseDismissal}
  onmouseleave={resumeDismissal}
  onfocusin={pauseDismissal}
  onfocusout={resumeDismissal}
>
  {#each toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl {toast.type ===
      'success'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger-ink/30 bg-danger/10 text-danger-ink'}"
    >
      <span class="text-sm">{toast.message}</span>
      {#if toast.undoAction}
        <button
          class="text-sm font-medium underline"
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
