<script lang="ts">
  // LaterList.svelte as a picture, collapsed as it first renders: "Later
  // today" over the next group of nearby slots, each line the slot time, the
  // upcoming dot, a small glyph, the name and dose, the group's first line
  // ending in how far off it is ("in 6 hours"), and the disclosure under the
  // card drawn as a span ("Show 3 more"). Like LaterList it draws nothing
  // when there are no rows, but its root stays mounted so its mark is
  // registered either way.
  import type { LaterRow } from "$lib/types";
  import { formatDosage } from "$lib/utils/dosage";
  import type { TimeFormat } from "$lib/utils/time";
  import {
    formatSlotTime,
    groupLaterRows,
    laterToggleLabel,
    laterUntil,
  } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
  import { stageButton } from "../stage-controls";
  import { useMark } from "../../marks";

  let {
    rows,
    now,
    todayStart,
    tz,
    timeFormat,
    mark,
  }: {
    rows: LaterRow[];
    now: Date;
    todayStart: Date;
    tz: string;
    timeFormat: TimeFormat;
    mark?: string;
  } = $props();

  const register = useMark();

  const groups = $derived(groupLaterRows(rows));
  const shown = $derived(groups[0]?.rows ?? []);
  const hiddenCount = $derived(rows.length - shown.length);
</script>

<div use:register={mark} data-stage-section="later">
  {#if rows.length > 0}
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Later today</p>
    <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
      {#each shown as row, i (row.key)}
        <div data-stage-row class="flex items-center gap-3 {i === 0 ? 'h-10' : 'h-8'}">
          <span class="text-text-secondary min-w-20 shrink-0 text-sm tabular-nums"
            >{formatSlotTime(new Date(row.expectedTime), todayStart, tz, timeFormat)}</span
          >
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
              >{laterUntil(row.expectedTime, now)}</span
            >
          {/if}
        </div>
      {/each}
    </div>
    {#if groups.length > 1}
      <span class="mt-2 {stageButton('ghost', 'sm')}">{laterToggleLabel(false, hiddenCount)}</span>
    {/if}
  {/if}
</div>
