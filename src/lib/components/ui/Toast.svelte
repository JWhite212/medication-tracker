<script lang="ts" module>
  type ToastItem = {
    id: string;
    message: string;
    type: 'success' | 'error';
    undoAction?: () => void;
  };

  let toasts = $state<ToastItem[]>([]);

  export function showToast(
    message: string,
    type: 'success' | 'error' = 'success',
    undoAction?: () => void
  ) {
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

<div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div
      class="flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl {toast.type === 'success'
        ? 'border-success/30 bg-success/10 text-success'
        : 'border-danger/30 bg-danger/10 text-danger'}"
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
