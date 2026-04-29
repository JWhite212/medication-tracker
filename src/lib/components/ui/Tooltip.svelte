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
  function hide() {
    visible = false;
  }
  function toggle() {
    visible ? hide() : show();
  }
</script>

<span class="relative ml-1 inline-flex items-center">
  <button
    type="button"
    class="border-glass-border text-text-muted hover:text-text-secondary hover:border-text-muted inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] transition-colors"
    aria-label="More info"
    bind:this={iconEl}
    onmouseenter={show}
    onmouseleave={hide}
    onclick={toggle}
    onfocusin={show}
    onfocusout={hide}>i</button
  >
  {#if visible}
    <div
      role="tooltip"
      class="border-glass-border bg-surface-overlay text-text-primary absolute left-1/2 z-30 w-max max-w-[250px] -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-lg {above
        ? 'bottom-full mb-2'
        : 'top-full mt-2'}"
    >
      {text}
      <div
        class="absolute left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-x-transparent {above
          ? 'border-t-surface-overlay top-full border-t-[5px]'
          : 'border-b-surface-overlay bottom-full border-b-[5px]'}"
      ></div>
    </div>
  {/if}
</span>
