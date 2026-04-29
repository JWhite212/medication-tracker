<script lang="ts">
  import type { Snippet } from "svelte";
  import { tick } from "svelte";

  let {
    open = false,
    onclose,
    title = "",
    children,
  }: { open: boolean; onclose: () => void; title?: string; children: Snippet } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();
  let previouslyFocused = $state<HTMLElement | null>(null);
  const titleId = title ? `modal-title-${crypto.randomUUID().slice(0, 8)}` : undefined;

  const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  $effect(() => {
    if (open && dialogEl) {
      previouslyFocused = document.activeElement as HTMLElement;
      tick().then(() => {
        const first = dialogEl?.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
      });
    }
    if (!open && previouslyFocused) {
      previouslyFocused.focus();
      previouslyFocused = null;
    }
  });

  function handleBackdrop(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onclose();
      return;
    }
    if (e.key !== "Tab" || !dialogEl) return;

    const focusable = dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={handleBackdrop}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
  >
    <div
      bind:this={dialogEl}
      class="border-glass-border bg-surface-raised w-full max-w-md rounded-xl border p-6 shadow-2xl"
    >
      {#if title && titleId}
        <h2 id={titleId} class="sr-only">{title}</h2>
      {/if}
      {@render children()}
    </div>
  </div>
{/if}
