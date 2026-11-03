<script lang="ts">
  import { tick, untrack } from "svelte";
  import type { LaterRow } from "$lib/types";
  import type { DashboardLaterMode } from "$lib/preferences/domains";
  import { formatDosage } from "$lib/utils/dosage";
  import type { TimeFormat } from "$lib/utils/time";
  import {
    formatSlotTime,
    groupLaterRows,
    laterToggleLabel,
    laterUntil,
  } from "$lib/utils/dashboard-copy";
  import Button from "$components/ui/Button.svelte";
  import { focusIfLost, pageHeading } from "$components/dose-writes/focus-after";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";

  let {
    rows,
    serverNow,
    todayStart,
    timezone,
    timeFormat,
    mode = "next",
  }: {
    rows: LaterRow[];
    /** The page's server-relative 60-second tick. */
    serverNow: Date;
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    /** "next" folds to the next group of slots; "all" starts with every slot shown. */
    mode?: DashboardLaterMode;
  } = $props();

  // Collapsed to the next group of slots by default: the rest of the day is
  // a glance, not a to-do list, and listing it all made Later the biggest
  // thing on the page. "all" is the account's choice to start unfolded; the
  // toggle still folds it for the visit. `untrack`: the mode seeds the state,
  // it is not a dependency of it.
  let expanded = $state(untrack(() => mode === "all"));

  const groups = $derived(groupLaterRows(rows));
  const shown = $derived(expanded ? groups : groups.slice(0, 1));
  const hiddenCount = $derived(rows.length - (groups[0]?.rows.length ?? 0));
  const hasToggle = $derived(groups.length > 1);
  let toggle = $state<HTMLButtonElement | HTMLAnchorElement | null>(null);

  // Edit mode renders the draft, so a preset (Full day, or leaving it)
  // changes `mode` on a list that is already mounted, and the preview is the
  // page (spec §5a). Only a CHANGE of mode re-seeds the fold: the previous
  // mode is a plain variable, so the 60s tick, a reload and the user's own
  // Show more/fewer never reach this, and a rerender with the same mode keeps
  // whatever fold the user chose.
  let previousMode = untrack(() => mode);
  $effect.pre(() => {
    const next = mode;
    if (next === previousMode) return;
    previousMode = next;
    expanded = next === "all";
  });

  // The dashboard reloads itself at slot boundaries, and a reload can leave
  // Later with one group, which removes the toggle. If the toggle held focus
  // it would fall to <body> with no user action, so it parks on the page's
  // h1 instead (without scrolling), the dashboard's usual last resort.
  // `pre`: the toggle is still in the DOM here, so we can ask whether it
  // held focus. Collapsing again means a later second group starts folded,
  // as the list first renders (expanded again under mode "all").
  $effect.pre(() => {
    if (hasToggle) return;
    expanded = mode === "all";
    if (toggle !== null && document.activeElement === toggle) {
      void tick().then(() => focusIfLost(pageHeading));
    }
  });
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
    {#if hasToggle}
      <Button
        bind:ref={toggle}
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
