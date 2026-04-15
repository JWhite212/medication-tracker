<script lang="ts">
  let { text }: { text: string } = $props();
  let visible = $state(false);
  let iconEl: HTMLButtonElement | undefined = $state();
  let above = $state(true);

  function show() {
    if (iconEl) {
      const rect = iconEl.getBoundingClientRect();
      above = rect.top > 80;
    }
    visible = true;
  }
  function hide() { visible = false; }
  function toggle() { visible ? hide() : show(); }
</script>

<span class="relative inline-flex items-center ml-1">
  <button
    type="button"
    class="inline-flex h-4 w-4 items-center justify-center rounded-full border border-glass-border text-[10px] text-text-muted hover:text-text-secondary hover:border-text-muted transition-colors"
    aria-label="More info"
    bind:this={iconEl}
    onmouseenter={show}
    onmouseleave={hide}
    onclick={toggle}
    onfocusin={show}
    onfocusout={hide}
  >i</button>
  {#if visible}
    <div
      role="tooltip"
      class="absolute left-1/2 z-30 w-max max-w-[250px] -translate-x-1/2 rounded-lg border border-glass-border bg-surface-overlay px-3 py-2 text-xs text-text-primary shadow-lg {above ? 'bottom-full mb-2' : 'top-full mt-2'}"
    >
      {text}
      <div class="absolute left-1/2 -translate-x-1/2 h-0 w-0 border-x-[5px] border-x-transparent {above ? 'top-full border-t-[5px] border-t-surface-overlay' : 'bottom-full border-b-[5px] border-b-surface-overlay'}"></div>
    </div>
  {/if}
</span>
