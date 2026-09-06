<script lang="ts">
  let { data, days = 90 }: { data: { date: string; count: number }[]; days?: number } = $props();

  const DAYS = $derived(days);

  const lookup = $derived(new Map(data.map((d) => [d.date, d.count])));
  const maxCount = $derived(data.reduce((m, d) => (d.count > m ? d.count : m), 1));

  const weeks = $derived.by(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDay = new Date(today.getTime() - (DAYS - 1) * 86400000);
    const cols: { date: string; count: number; row: number }[][] = [];
    let currentCol: { date: string; count: number; row: number }[] = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(startDay.getTime() + i * 86400000);
      const dateStr = d.toISOString().split("T")[0];
      const row = d.getDay();
      if (i > 0 && row === 0) {
        cols.push(currentCol);
        currentCol = [];
      }
      currentCol.push({ date: dateStr, count: lookup.get(dateStr) ?? 0, row });
    }
    if (currentCol.length > 0) cols.push(currentCol);
    return cols;
  });

  let wrapper = $state<HTMLDivElement | null>(null);
  let tooltip = $state<{ text: string; x: number; y: number } | null>(null);

  function intensity(count: number): string {
    if (count === 0) return "bg-heatmap-0";
    const ratio = count / maxCount;
    if (ratio < 0.25) return "bg-heatmap-1";
    if (ratio < 0.5) return "bg-heatmap-2";
    if (ratio < 0.75) return "bg-heatmap-3";
    return "bg-heatmap-4";
  }

  function showTooltip(e: MouseEvent, date: string, count: number) {
    if (!wrapper) return;
    const cellRect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    tooltip = {
      text: `${date}: ${count} dose${count !== 1 ? "s" : ""}`,
      x: cellRect.left - wrapperRect.left,
      y: cellRect.top - wrapperRect.top - 28,
    };
  }

  function hideTooltip() {
    tooltip = null;
  }
</script>

<div bind:this={wrapper} class="relative overflow-x-auto">
  <div class="flex gap-[1px]">
    {#each weeks as week, weekIdx}
      <div class="flex flex-col gap-[1px]">
        {#each Array(7) as _, rowIdx}
          {@const cell = week.find((c) => c.row === rowIdx)}
          {#if cell}
            <div
              class="heatmap-cell animate-fade-in h-[11px] w-[11px] cursor-default rounded-[2px] transition-opacity hover:opacity-80 {intensity(
                cell.count,
              )}"
              style="animation-delay: {weekIdx * 15}ms"
              role="img"
              aria-label="{cell.date}: {cell.count} doses logged"
              onmouseenter={(e) => showTooltip(e, cell.date, cell.count)}
              onmouseleave={hideTooltip}
            ></div>
          {:else}
            <div class="h-[11px] w-[11px]"></div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>

  {#if tooltip}
    <div
      class="border-glass-border text-text-primary pointer-events-none absolute z-30 rounded-sm border px-2 py-1 text-xs shadow-lg backdrop-blur-xl"
      style="left: {tooltip.x}px; top: {tooltip.y}px; background-color: var(--color-surface-overlay)"
    >
      {tooltip.text}
    </div>
  {/if}
</div>

<style>
  /* Two independent switches. The media query is the OS setting; the
     attribute is the app's own preference, set on a wrapper in
     (app)/+layout.svelte. The attribute selector MUST be :global() — it
     targets an ancestor outside this component's scope, and without it
     Svelte compiles the rule away as an unused selector and the toggle
     silently does nothing. See tests/unit/heatmap-motion.test.ts. */
  @media (prefers-reduced-motion: reduce) {
    .heatmap-cell {
      animation-delay: 0ms !important;
    }
  }

  :global([data-reduced-motion="true"]) .heatmap-cell {
    animation-delay: 0ms !important;
  }
</style>
