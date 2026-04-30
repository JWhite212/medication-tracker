<script lang="ts">
  type Props = {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
    expectedTotal: number;
  };

  let { takenEvents, skippedEvents, missedEvents, expectedTotal }: Props = $props();

  const total = $derived(Math.max(takenEvents + skippedEvents + missedEvents, 1));
  const takenPct = $derived(Math.round((takenEvents / total) * 1000) / 10);
  const skippedPct = $derived(Math.round((skippedEvents / total) * 1000) / 10);
  const missedPct = $derived(Math.max(0, 100 - takenPct - skippedPct));
</script>

{#if expectedTotal > 0 || takenEvents + skippedEvents > 0}
  <div class="space-y-2">
    <div class="bg-surface-overlay flex h-3 w-full overflow-hidden rounded-full">
      {#if takenPct > 0}
        <div
          class="bg-success h-full"
          style="width: {takenPct}%"
          title="Taken: {takenEvents}"
        ></div>
      {/if}
      {#if skippedPct > 0}
        <div
          class="bg-warning h-full"
          style="width: {skippedPct}%"
          title="Skipped: {skippedEvents}"
        ></div>
      {/if}
      {#if missedPct > 0}
        <div
          class="bg-danger h-full"
          style="width: {missedPct}%"
          title="Missed: {missedEvents}"
        ></div>
      {/if}
    </div>
    <div class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <span class="flex items-center gap-1.5">
        <span class="bg-success inline-block h-2 w-2 rounded-full" aria-hidden="true"></span>
        Taken {takenEvents}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="bg-warning inline-block h-2 w-2 rounded-full" aria-hidden="true"></span>
        Skipped {skippedEvents}
      </span>
      <span class="flex items-center gap-1.5">
        <span class="bg-danger inline-block h-2 w-2 rounded-full" aria-hidden="true"></span>
        Missed {missedEvents}
      </span>
      <span class="text-text-muted ml-auto">{expectedTotal} expected</span>
    </div>
  </div>
{/if}
