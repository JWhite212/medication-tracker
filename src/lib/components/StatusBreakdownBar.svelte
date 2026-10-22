<script lang="ts" module>
  import { toneClass, toneOf } from "$lib/utils/status-tone";

  // The segment and legend fills, exported for the same reason as the split:
  // the walkthrough draws this bar without mounting it.
  export const STATUS_BREAKDOWN_FILLS = {
    taken: toneClass(toneOf("dose-taken"), "bar"),
    skipped: toneClass(toneOf("dose-skipped"), "bar"),
    missed: toneClass(toneOf("dose-missed"), "bar"),
  } as const;

  // Exported so a surface that cannot mount this card still draws the bar by
  // the same rule: the landing-page walkthrough has no headings, and this
  // card renders an <h2>.
  export function statusBreakdownSegments(counts: {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
  }): { takenPct: number; skippedPct: number; missedPct: number } {
    const { takenEvents, skippedEvents, missedEvents } = counts;
    const total = Math.max(takenEvents + skippedEvents + missedEvents, 1);
    const takenPct = Math.round((takenEvents / total) * 1000) / 10;
    const skippedPct = Math.round((skippedEvents / total) * 1000) / 10;
    const missedPct = Math.max(0, 100 - takenPct - skippedPct);
    return { takenPct, skippedPct, missedPct };
  }
</script>

<script lang="ts">
  import GlassCard from "$components/ui/GlassCard.svelte";

  type Props = {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
    expectedTotal: number;
  };

  let { takenEvents, skippedEvents, missedEvents, expectedTotal }: Props = $props();

  const { takenPct, skippedPct, missedPct } = $derived(
    statusBreakdownSegments({ takenEvents, skippedEvents, missedEvents }),
  );
</script>

{#if expectedTotal > 0 || takenEvents + skippedEvents > 0}
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Dose Status Breakdown</h2>
    <div class="space-y-2">
      <div class="bg-surface-overlay flex h-3 w-full overflow-hidden rounded-full">
        {#if takenPct > 0}
          <div
            class="h-full {STATUS_BREAKDOWN_FILLS.taken}"
            style="width: {takenPct}%"
            title="Taken: {takenEvents}"
          ></div>
        {/if}
        {#if skippedPct > 0}
          <div
            class="h-full {STATUS_BREAKDOWN_FILLS.skipped}"
            style="width: {skippedPct}%"
            title="Skipped: {skippedEvents}"
          ></div>
        {/if}
        {#if missedPct > 0}
          <div
            class="h-full {STATUS_BREAKDOWN_FILLS.missed}"
            style="width: {missedPct}%"
            title="Missed: {missedEvents}"
          ></div>
        {/if}
      </div>
      <div class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-2 w-2 rounded-full {STATUS_BREAKDOWN_FILLS.taken}"
            aria-hidden="true"
          ></span>
          Taken {takenEvents}
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-2 w-2 rounded-full {STATUS_BREAKDOWN_FILLS.skipped}"
            aria-hidden="true"
          ></span>
          Skipped {skippedEvents}
        </span>
        <span class="flex items-center gap-1.5">
          <span
            class="inline-block h-2 w-2 rounded-full {STATUS_BREAKDOWN_FILLS.missed}"
            aria-hidden="true"
          ></span>
          Missed {missedEvents}
        </span>
        <span class="text-text-muted ml-auto">{expectedTotal} expected</span>
      </div>
    </div>
  </GlassCard>
{/if}
