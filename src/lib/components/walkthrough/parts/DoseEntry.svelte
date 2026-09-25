<script lang="ts">
  // TimelineEntry.svelte as a desktop pointer sees it before hovering: the
  // edit and delete buttons are hidden, and the empty 68px box (two 32px
  // targets and their 4px gap) keeps their space so rows line up with the
  // real page.
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import type { DemoMedication } from "../demo-data";

  let {
    medication,
    time,
    since,
    sideEffect,
  }: { medication: DemoMedication; time: string; since: string; sideEffect?: string } = $props();
</script>

<div class="border-glass-border bg-glass rounded-lg border p-4">
  <div class="flex items-center gap-4">
    <div
      class="h-3 w-3 shrink-0 rounded-full"
      style:background={getMedicationBackground(
        medication.colour,
        medication.colourSecondary,
        medication.pattern,
        true,
      )}
    ></div>
    <div class="min-w-0 flex-1">
      <p class="font-medium">
        <span>{medication.name}</span>
        <span class="text-text-secondary text-sm">{medication.amount}{medication.unit}</span>
      </p>
    </div>
    <div class="flex items-center gap-4 text-sm">
      <span class="text-text-secondary">{time}</span>
      <span class="text-accent-ink font-medium tabular-nums">{since}</span>
    </div>
    <div class="w-17 shrink-0"></div>
  </div>
  {#if sideEffect}
    <div class="mt-2 flex flex-wrap gap-1.5 pl-7">
      <span
        class="bg-text-secondary/30 text-text-primary rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
        >{sideEffect}</span
      >
    </div>
  {/if}
</div>
