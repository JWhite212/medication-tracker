<script lang="ts">
  /**
   * `label` names the field this explains. Without it every instance of this
   * component announced as the same bare "More info" — twelve of them across the
   * medication form, the edit page and Appearance, none saying what they were
   * about.
   */
  let { text, label }: { text: string; label: string } = $props();
  let visible = $state(false);
  let iconEl: HTMLButtonElement | undefined = $state();
  let above = $state(true);

  // SSR-stable, unlike crypto.randomUUID(): the id is rendered into
  // aria-describedby on the server and must survive hydration unchanged.
  const tipId = $props.id();

  // WCAG 1.4.13 requires tooltip content stay visible while the pointer travels
  // to it. The panel is absolutely positioned, so it contributes nothing to the
  // trigger's hit box and a bare onmouseleave dismissed it the instant the
  // pointer set off — unreadable for anyone using magnification. A short grace
  // period, cancelled by entering either element, is what makes it hoverable.
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function show() {
    clearTimeout(hideTimer);
    if (iconEl) {
      const rect = iconEl.getBoundingClientRect();
      above = rect.top > 80;
    }
    visible = true;
  }
  function hide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => (visible = false), 150);
  }
  function hideNow() {
    clearTimeout(hideTimer);
    visible = false;
  }
  function toggle() {
    visible ? hideNow() : show();
  }

  $effect(() => () => clearTimeout(hideTimer));
</script>

<svelte:window
  onkeydown={(e) => {
    // 1.4.13 "dismissible": Escape must close it without moving the pointer.
    if (e.key === "Escape" && visible) hideNow();
  }}
/>

<span class="relative ml-1 inline-flex items-center">
  <button
    type="button"
    class="border-glass-border text-text-muted hover:text-text-secondary hover:border-text-muted inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] transition-colors"
    aria-label="More info about {label}"
    aria-describedby={visible ? tipId : undefined}
    bind:this={iconEl}
    onmouseenter={show}
    onmouseleave={hide}
    onclick={toggle}
    onfocusin={show}
    onfocusout={hideNow}>i</button
  >
  {#if visible}
    <!-- Mouse handlers keep the panel open while the pointer is over it. It has
         no interactive content of its own, so it needs no key handler; Escape is
         bound at the window above. -->
    <div
      id={tipId}
      role="tooltip"
      onmouseenter={show}
      onmouseleave={hide}
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
