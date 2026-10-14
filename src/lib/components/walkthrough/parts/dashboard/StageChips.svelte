<script lang="ts">
  // QuickLogBar.svelte as a picture, under the page's "Log something else"
  // eyebrow: one 44px neutral chip per medication, in medication order. Each
  // chip is `−`, then a small glyph and the dose label, then `+`. The
  // medication's colours appear only in the glyph. At quantity 1 the app
  // draws `−` aria-disabled, so here it is drawn `text-text-muted` as a
  // plain class. The chips are on screen in the Today shot and never tapped.
  import { formatDoseLabel } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import type { StageMedication } from "../../demo-dashboard";
  import { useMark } from "../../marks";

  let { medications, mark }: { medications: StageMedication[]; mark?: string } = $props();

  const register = useMark();
</script>

<div use:register={mark} data-stage-section="chips">
  <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">
    Log something else
  </p>
  <div class="flex flex-wrap gap-2">
    {#each medications as med (med.id)}
      <div
        data-stage-row
        class="border-border-strong bg-glass text-text-primary box-content flex h-11 items-center overflow-hidden rounded-full border"
      >
        <span
          class="text-text-muted flex h-11 w-11 shrink-0 items-center justify-center text-base select-none"
          >−</span
        >
        <span
          class="text-text-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium"
        >
          <MedicationGlyph
            colour={med.colour}
            colourSecondary={med.colourSecondary}
            pattern={med.pattern}
            size="sm"
          />
          <span>{formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit)}</span>
        </span>
        <span class="flex h-11 w-11 shrink-0 items-center justify-center text-base select-none"
          >+</span
        >
      </div>
    {/each}
  </div>
</div>
