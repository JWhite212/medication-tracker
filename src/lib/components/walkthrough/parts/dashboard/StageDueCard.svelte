<script lang="ts">
  // DueCard.svelte as a picture: the same grid, glyph, marker and copy, with
  // every control drawn as a span and DoseActionForm's variant classes
  // copied without their hover and transition classes. A row offers what
  // DueCard's `actions` snippet offers, by the same rule: Log now when
  // `row.logNow`, Took it at when `row.tookItAt !== null`, Skip when
  // `row.skipAt !== null`. Those are payload values, fixed for the whole
  // loop, so the {#if} around the marked Log now never changes with T.
  //
  // `pending` is the spinner's angle in degrees while Log now reads
  // "Logging…", or null. Label and pending text share one grid cell, as in
  // DoseActionForm, so the button keeps its width; the spinner turns by
  // `pending`, never by an animate-spin class.
  import type { DueCard, DueRow } from "$lib/types";
  import type { TimeFormat } from "$lib/utils/time";
  import { formatSlotTime, rowStatusLine, tookItAtLabel } from "$lib/utils/dashboard-copy";
  import { toneClass, toneOf } from "$lib/utils/status-tone";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
  import { useMark } from "../../marks";

  let {
    card,
    now,
    todayStart,
    tz,
    timeFormat,
    pending,
    logNowMark,
  }: {
    card: DueCard;
    now: Date;
    todayStart: Date;
    tz: string;
    timeFormat: TimeFormat;
    pending: number | null;
    logNowMark?: string;
  } = $props();

  const register = useMark();

  const top = $derived(card.rows[0]);
  const rest = $derived(card.rows.slice(1));
  const dose = $derived(`${card.dosageAmount}${card.dosageUnit}`);
  // DueCard's expression: the due-now edge is accent, not status.
  const border = $derived(
    top.state === "due-now" ? "border-accent-ink/50" : toneClass(toneOf("dose-overdue"), "border"),
  );

  function markerFor(row: DueRow): "due-now" | "overdue" {
    return row.state === "due-now" ? "due-now" : "overdue";
  }

  function view(row: DueRow) {
    const slot = new Date(row.expectedTime);
    return {
      status: rowStatusLine(
        { state: row.state, expectedTime: slot },
        now,
        todayStart,
        tz,
        timeFormat,
      ),
      tookItAt: tookItAtLabel(formatSlotTime(slot, todayStart, tz, timeFormat)),
    };
  }
  type RowView = ReturnType<typeof view>;

  const topView = $derived(view(top));
</script>

{#snippet face(label: string, pendingLabel: string, angle: number | null)}
  <span class="inline-grid">
    <span
      class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {angle === null
        ? ''
        : 'invisible'}">{label}</span
    >
    <span
      class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {angle === null
        ? 'invisible'
        : ''}"
      ><span
        class="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
        style:transform="rotate({angle ?? 0}deg)"
      ></span><span>{pendingLabel}</span></span
    >
  </span>
{/snippet}

{#snippet actions(row: DueRow, v: RowView)}
  {#if row.logNow}
    <div class="col-start-3 row-span-2 row-start-1">
      <span
        use:register={logNowMark}
        class="bg-accent text-accent-fg inline-flex h-12 min-w-26 items-center justify-center rounded-lg px-4 text-base font-semibold"
        >{@render face("Log now", "Logging…", pending)}</span
      >
    </div>
  {/if}
  {#if row.tookItAt !== null || row.skipAt !== null}
    <div class="col-start-2 mt-2 flex flex-wrap gap-2">
      {#if row.tookItAt !== null}
        <span
          class="border-border-strong text-text-primary inline-flex h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium"
          >{@render face(v.tookItAt, "Recording…", null)}</span
        >
      {/if}
      {#if row.skipAt !== null}
        <span
          class="text-text-secondary inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium"
          >{@render face("Skip", "Skipping…", null)}</span
        >
      {/if}
    </div>
  {/if}
{/snippet}

<div class="bg-glass rounded-xl border p-3 backdrop-blur-xl {border}">
  <div data-stage-row class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
    <div class="row-span-2 flex flex-col items-center gap-2 pt-1">
      <MedicationGlyph
        colour={card.colour}
        colourSecondary={card.colourSecondary}
        pattern={card.pattern}
        size="md"
      />
      <StatusMarker state={markerFor(top)} />
    </div>
    <div class="min-w-0">
      <p class="flex min-w-0 items-baseline gap-2">
        <span class="text-text-primary text-base font-semibold">{card.name}</span>
        <span class="text-text-secondary truncate text-sm">{dose}</span>
      </p>
      <p class="text-text-primary text-sm">{topView.status}</p>
    </div>
    {@render actions(top, topView)}
  </div>

  {#if rest.length > 0}
    <div class="border-glass-border mt-3 space-y-3 border-t pt-3">
      {#each rest as row (row.key)}
        {@const v = view(row)}
        <div data-stage-row class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
          <div class="row-span-2 flex justify-center pt-0.5">
            <StatusMarker state={markerFor(row)} />
          </div>
          <p class="text-text-primary min-w-0 text-sm">{v.status}</p>
          {@render actions(row, v)}
        </div>
      {/each}
    </div>
  {/if}
</div>
