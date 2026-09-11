<script lang="ts">
  import type { Snippet } from "svelte";
  import { tick } from "svelte";
  import { collectFocusable, trapTab } from "$lib/utils/focus-trap";

  let {
    open = false,
    onclose,
    title,
    children,
  }: { open: boolean; onclose: () => void; title: string; children: Snippet } = $props();

  let dialogEl: HTMLDivElement | undefined = $state();
  let previouslyFocused = $state<HTMLElement | null>(null);

  /** Return the dialog's enabled, visible focus targets in document order. */
  function focusableItems(): HTMLElement[] {
    return dialogEl ? collectFocusable(dialogEl) : [];
  }

  $effect(() => {
    if (open && dialogEl) {
      previouslyFocused = document.activeElement as HTMLElement;
      tick().then(() => {
        // Fall back to the dialog itself (tabindex="-1") when it holds no
        // focusable control, so focus still leaves the page behind it.
        (focusableItems()[0] ?? dialogEl)?.focus();
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

  /**
   * Bound to the window rather than the backdrop. The backdrop is a DESCENDANT
   * of <body>, so while focus sat outside the dialog — which, per the FOCUSABLE
   * bug above, was always — keydown fired at body and never reached the handler.
   * Escape simply did nothing. At window level it works wherever focus is, and
   * Tab can pull focus back in if it has escaped the dialog.
   */
  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      onclose();
      return;
    }
    if (e.key !== "Tab" || !dialogEl) return;
    trapTab(dialogEl, e);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- The backdrop is presentational: clicking it is a redundant shortcut for
       Escape (handled on window) and for each dialog's own Cancel control, so it
       needs no key handler of its own. role/aria-modal live on the panel below,
       which is the actual dialog — the backdrop is the scrim around it. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="bg-scrim fixed inset-0 z-40 flex items-center justify-center backdrop-blur-sm"
    onclick={handleBackdrop}
  >
    <div
      bind:this={dialogEl}
      class="border-glass-border bg-surface-raised w-full max-w-md rounded-xl border p-6 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
    >
      {@render children()}
    </div>
  </div>
{/if}
