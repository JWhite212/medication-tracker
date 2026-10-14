<script lang="ts">
  // DoneList.svelte as a picture: "Done today" over one glass card of
  // divided rows. Each row has the time, the status marker, a small glyph,
  // the name and dose, the covers line ("for 08:00") underneath, and Edit
  // drawn as a span. The rows are `after`'s. A row `before` lacks is the dose
  // the beat logs: it grows in with `logged`, and is drawn at zero height,
  // but mounted, before the log. A row only `before` has is not drawn at all,
  // and the fidelity test's before-render fails if one ever appears.
  //
  // DoneList's `divide-y` is written out as `border-t` on every row after the
  // first, so a growing row's divider sits inside its collapse and is hidden
  // with it.
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { doneCoversLine, doneDoseText } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
  import type { StageDone } from "../../demo-dashboard";
  import { useMark } from "../../marks";
  import StageCollapse from "./StageCollapse.svelte";

  let {
    before,
    after,
    logged,
    todayStart,
    tz,
    timeFormat,
    mark,
  }: {
    before: StageDone[];
    after: StageDone[];
    logged: number;
    todayStart: Date;
    tz: string;
    timeFormat: TimeFormat;
    mark?: string;
  } = $props();

  const register = useMark();

  const beforeKeys = $derived(new Set(before.map((row) => row.key)));

  function view(row: StageDone) {
    return {
      time: formatUserTime(row.dose.takenAt, tz, timeFormat),
      dose: doneDoseText(row.dose),
      covers: doneCoversLine(row.covers, todayStart, tz, timeFormat),
    };
  }
</script>

<div use:register={mark} data-stage-section="done">
  <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Done today</p>
  <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
    {#each after as row, index (row.key)}
      {@const v = view(row)}
      <StageCollapse factor={beforeKeys.has(row.key) ? 1 : logged}>
        <div
          data-stage-row
          class="flex min-h-11 items-center gap-3 py-1 {index > 0
            ? 'border-glass-border border-t'
            : ''}"
        >
          <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
            {#if row.dayLabel === "yesterday"}
              <span class="block text-xs">Yesterday</span>
            {/if}
            <span>{v.time}</span>
          </span>
          <StatusMarker state={row.dose.status} />
          <MedicationGlyph
            colour={row.dose.colour}
            colourSecondary={row.dose.colourSecondary}
            pattern={row.dose.pattern}
            size="sm"
          />
          <div class="min-w-0 flex-1">
            <p class="flex min-w-0 items-baseline gap-2 text-sm">
              <span class="text-text-primary truncate font-medium">{row.dose.name}</span>
              <span class="text-text-secondary shrink-0">{v.dose}</span>
              {#if row.dose.status === "skipped"}
                <span class="text-text-secondary shrink-0">Skipped</span>
              {/if}
            </p>
            {#if v.covers}
              <p class="text-text-secondary truncate text-xs">{v.covers}</p>
            {/if}
          </div>
          {#if row.dose.status === "taken"}
            <span
              class="border-border-strong text-text-primary inline-flex h-11 shrink-0 items-center rounded-lg border px-3 text-sm font-medium"
              >Edit</span
            >
          {:else}
            <span
              class="text-text-secondary inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium"
              >Remove skip</span
            >
          {/if}
        </div>
      </StageCollapse>
    {/each}
  </div>
</div>
