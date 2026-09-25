<script lang="ts">
  import type { LaterRow } from "$lib/types";
  import { formatDuration, type TimeFormat } from "$lib/utils/time";
  import { formatSlotTime } from "$lib/utils/dashboard-copy";
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

  /** "in 3 hours": long style, one unit, measured on the server's clock. */
  function until(row: LaterRow): string {
    const ms = Date.parse(row.expectedTime) - serverNow.getTime();
    return `in ${formatDuration(ms, { style: "long", maxUnits: 1 })}`;
  }
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
      <ul role="list">
        {#each rows as row (row.key)}
          <li class="flex h-10 items-center gap-3">
            <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
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
              <span class="text-text-secondary shrink-0">{row.dosageAmount}{row.dosageUnit}</span>
            </p>
            <span class="text-text-secondary shrink-0 text-sm">{until(row)}</span>
          </li>
        {/each}
      </ul>
    </div>
  </section>
{/if}
