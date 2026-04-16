<script lang="ts">
  let { data }: { data: { date: string; count: number }[] } = $props();

  const DAYS = 90;

  const lookup = $derived(new Map(data.map((d) => [d.date, d.count])));
  const maxCount = $derived(data.reduce((m, d) => d.count > m ? d.count : m, 1));

  const weeks = $derived.by(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDay = new Date(today.getTime() - (DAYS - 1) * 86400000);
    const cols: { date: string; count: number; row: number }[][] = [];
    let currentCol: { date: string; count: number; row: number }[] = [];
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(startDay.getTime() + i * 86400000);
      const dateStr = d.toISOString().split('T')[0];
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

  let tooltip = $state<{ text: string; x: number; y: number } | null>(null);

  function intensity(count: number): string {
    if (count === 0) return 'bg-white/10';
    const ratio = count / maxCount;
    if (ratio < 0.25) return 'bg-emerald-500/30';
    if (ratio < 0.5) return 'bg-emerald-500/55';
    if (ratio < 0.75) return 'bg-emerald-500/80';
    return 'bg-emerald-500';
  }

  function showTooltip(e: MouseEvent, date: string, count: number) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    tooltip = { text: `${date}: ${count} dose${count !== 1 ? 's' : ''}`, x: rect.left, y: rect.top - 28 };
  }

  function hideTooltip() {
    tooltip = null;
  }
</script>

<div class="relative overflow-x-auto">
  <div class="flex gap-[1px]">
    {#each weeks as week, weekIdx}
      <div class="flex flex-col gap-[1px]">
        {#each Array(7) as _, rowIdx}
          {@const cell = week.find((c) => c.row === rowIdx)}
          {#if cell}
            <div
              class="h-[11px] w-[11px] cursor-default rounded-[2px] transition-opacity hover:opacity-80 animate-fade-in {intensity(cell.count)}"
              style="animation-delay: {weekIdx * 15}ms"
              role="img"
              aria-label="{cell.date}: {cell.count} doses"
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
      class="pointer-events-none fixed z-30 rounded bg-gray-900 px-2 py-1 text-xs text-white shadow"
      style="left: {tooltip.x}px; top: {tooltip.y}px;"
    >
      {tooltip.text}
    </div>
  {/if}
</div>
