<script lang="ts">
  import type { LaterRow } from "$lib/types";
  import { formatDosage } from "$lib/utils/dosage";
  import type { TimeFormat } from "$lib/utils/time";
  import {
    formatSlotTime,
    groupLaterRows,
    laterToggleLabel,
    laterUntil,
  } from "$lib/utils/dashboard-copy";
  import Button from "$components/ui/Button.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";

  let {
    rows,
    serverNow,
    todayStart,
    timezone,
    timeFormat,
  }: {
    rows: LaterRow[];
    /** The page's server-relative 60-second tick. */
    serverNow: Date;
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
  } = $props();

  // Collapsed to the next group of slots by default: the rest of the day is
  // a glance, not a to-do list, and listing it all made Later the biggest
  // thing on the page. Not remembered across loads (yet).
  let expanded = $state(false);

  const groups = $derived(groupLaterRows(rows));
  const shown = $derived(expanded ? groups : groups.slice(0, 1));
  const hiddenCount = $derived(rows.length - (groups[0]?.rows.length ?? 0));
</script>

<!-- Renders nothing when empty (the RefillsCard convention), so the page does not wrap it in {#if}. -->
{#if rows.length > 0}
  <section aria-labelledby="later-heading">
    <h2
      id="later-heading"
      class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
    >
      Later today
    </h2>
    <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
      <!-- Flat, one item per slot, so a screen reader hears every time. A
           group is drawn, not nested: its first slot carries the divider
           above it and the "in …", the rest sit tighter beneath. -->
      <ul role="list" id="later-list">
        {#each shown as group, g (group.key)}
          {#each group.rows as row, i (row.key)}
            <li
              data-later-group-start={i === 0 ? "" : undefined}
              class="flex items-center gap-3 {i === 0 ? 'h-10' : 'h-8'} {i === 0 && g > 0
                ? 'border-glass-border border-t'
                : ''}"
            >
              <span class="text-text-secondary min-w-20 shrink-0 text-sm tabular-nums">
                {formatSlotTime(new Date(row.expectedTime), todayStart, timezone, timeFormat)}
              </span>
              <StatusMarker state="upcoming" />
              <MedicationGlyph
                colour={row.colour}
                colourSecondary={row.colourSecondary}
                pattern={row.pattern}
                size="sm"
              />
              <p class="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
                <span class="text-text-primary truncate font-medium">{row.name}</span>
                <span class="text-text-secondary shrink-0"
                  >{formatDosage(row.dosageAmount, row.dosageUnit)}</span
                >
              </p>
              {#if i === 0}
                <span class="text-text-secondary shrink-0 text-sm"
                  >{laterUntil(row.expectedTime, serverNow)}</span
                >
              {/if}
            </li>
          {/each}
        {/each}
      </ul>
    </div>
    {#if groups.length > 1}
      <Button
        variant="ghost"
        size="sm"
        class="mt-2"
        aria-expanded={expanded}
        aria-controls="later-list"
        onclick={() => (expanded = !expanded)}
      >
        {laterToggleLabel(expanded, hiddenCount)}
      </Button>
    {/if}
  </section>
{/if}
