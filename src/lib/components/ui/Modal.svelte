<script lang="ts">
  import type { Snippet } from 'svelte';

  let { open = false, onclose, children }: { open: boolean; onclose: () => void; children: Snippet } = $props();

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={handleBackdrop}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div class="w-full max-w-md rounded-xl border border-glass-border bg-surface-raised p-6 shadow-2xl">
      {@render children()}
    </div>
  </div>
{/if}
