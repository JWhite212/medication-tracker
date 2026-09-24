<script lang="ts">
  // SummaryStrip.svelte followed by RefillsCard.svelte, as they sit together at
  // the top of the dashboard.
  import { MEDICATION_BY_ID } from "../demo-data";
  import { useMark } from "../marks";

  let {
    count,
    overdue = 0,
    overdueOpacity = 1,
    markKey,
  }: { count: number; overdue?: number; overdueOpacity?: number; markKey?: string } = $props();

  const mark = useMark();
</script>

<div
  use:mark={markKey}
  class="border-glass-border bg-glass flex items-center justify-between rounded-lg border px-5 py-3"
>
  <span class="text-text-secondary text-sm font-medium">
    <span class="text-text-primary text-lg font-bold">{count}</span> doses today
  </span>
  <div class="flex items-center gap-2">
    {#if overdue > 0 && overdueOpacity > 0.01}
      <span
        class="bg-warning/15 text-warning rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap"
        style:opacity={overdueOpacity}>{overdue} overdue</span
      >
    {/if}
  </div>
</div>

<div>
  <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Refills</p>
  <div class="border-info/30 bg-info/5 flex items-center gap-3 rounded-lg border p-3">
    <span class="h-2.5 w-2.5 shrink-0 rounded-full" style:background={MEDICATION_BY_ID.ibu.colour}
    ></span>
    <span class="min-w-0 flex-1 truncate font-medium">Ibuprofen</span>
    <span class="text-info shrink-0 text-xs">8 days left</span>
  </div>
</div>
