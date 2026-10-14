<script lang="ts">
  // LaterList.svelte as a picture: "Later today" over 40px read-only lines,
  // each the slot time, a hollow ring marker, a small glyph, the name and
  // dose, and how far off it is ("in 6 hours"). Like LaterList it draws
  // nothing when there are no rows, but its root stays mounted so its mark
  // is registered either way.
  import type { LaterRow } from "$lib/types";
  import type { TimeFormat } from "$lib/utils/time";
  import { formatSlotTime, laterUntil } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
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
</script>

<div use:register={mark} data-stage-section="later">
  {#if rows.length > 0}
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Later today</p>
    <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
      {#each rows as row (row.key)}
        <div data-stage-row class="flex h-10 items-center gap-3">
          <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums"
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
            <span class="text-text-secondary shrink-0">{row.dosageAmount}{row.dosageUnit}</span>
          </p>
          <span class="text-text-secondary shrink-0 text-sm"
            >{laterUntil(row.expectedTime, now)}</span
          >
        </div>
      {/each}
    </div>
  {/if}
</div>
