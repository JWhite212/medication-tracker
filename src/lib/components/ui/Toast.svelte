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
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, 5000);
  }

  export function dismissToast(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
  }
</script>

<div class="fixed right-4 bottom-4 z-50 flex flex-col gap-2" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl {toast.type ===
      'success'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger-ink/30 bg-danger/10 text-danger-ink'}"
      role="alert"
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
