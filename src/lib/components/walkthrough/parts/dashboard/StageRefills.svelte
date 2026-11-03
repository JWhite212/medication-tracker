<script lang="ts">
  // RefillsCard.svelte as a picture, last on the page as it is in the app.
  // Each row is a colour dot, the name and the days left, drawn as a <div>
  // where the app has a link, under a <p> where the app has an <h2>. The
  // tint and the days-left wording are RefillsCard's own exported rules, so
  // a change to the card's wording changes the stage with it. Only the
  // card's hover and transition classes are left out.
  import type { RefillForecastEntry } from "$lib/types";
  import {
    refillChip,
    refillDaysLabel,
    refillLabelClass,
    refillRowClass,
  } from "$components/RefillsCard.svelte";

  type Entry = Pick<
    RefillForecastEntry,
    "medicationId" | "medicationName" | "colour" | "daysUntilRefill" | "severity"
  > &
    Partial<Pick<RefillForecastEntry, "inventoryCount" | "inventoryAlertThreshold">>;

  let { entries }: { entries: readonly Entry[] } = $props();
</script>

{#if entries.length > 0}
  <div>
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Refills</p>
    <div class="space-y-2">
      {#each entries as entry (entry.medicationId)}
        <!-- STAGE_REFILLS carries no count or alert threshold, because the demo
             draws none. With no threshold, refillChip reads the count only
             when the days are null, and every stage row has days. -->
        {@const label = refillChip({
          severity: entry.severity,
          daysUntilRefill: entry.daysUntilRefill,
          inventoryCount: entry.inventoryCount ?? null,
          inventoryAlertThreshold: entry.inventoryAlertThreshold ?? null,
        })}
        {@const tone = label?.tone ?? "neutral"}
        <div class="flex items-center gap-3 rounded-lg border p-3 {refillRowClass(tone)}">
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" style:background-color={entry.colour}
          ></span>
          <span class="min-w-0 flex-1 truncate font-medium">{entry.medicationName}</span>
          <span class="shrink-0 text-xs {refillLabelClass(tone)}">
            <!-- The space is an expression because Svelte drops a literal one at an {#if} edge. -->
            <!-- eslint-disable-next-line svelte/no-useless-mustaches -->
            {#if label?.glyph}<span aria-hidden="true">{label.glyph}</span>{" "}{/if}{label?.text ??
              refillDaysLabel(entry.daysUntilRefill)}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}
