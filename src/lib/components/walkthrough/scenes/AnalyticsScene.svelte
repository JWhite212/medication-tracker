<script lang="ts">
  // routes/(app)/analytics/+page.svelte over 90 days. `load` (seconds into the
  // shot) brings the stat cards in and counts them up; `heat` (0..1) fills the
  // activity heatmap week by week.
  import Sparkline from "$components/Sparkline.svelte";
  import { DISCLAIMER_TEXT } from "$components/MedicalDisclaimer.svelte";
  import {
    ADHERENCE_TRENDS,
    HEATMAP_WEEKS,
    HISTORY,
    MEDICATIONS,
    heatmapIntensity,
  } from "../demo-data";
  import { useMark } from "../marks";
  import { MOTION, clamp01 } from "../timeline";
  import Glyph from "../parts/Glyph.svelte";

  let { load, heat }: { load: number; heat: number } = $props();

  const mark = useMark();

  const entrance = (i: number) => MOTION.enter(load, 0.05 + i * 0.12, 0.5);
  const count = $derived(MOTION.enter(load, 0.1, 1.1));
  const draw = $derived(MOTION.enter(load, 0.45, 0.9));
  const skipped = HISTORY.expected - HISTORY.total;
  const takenPercent = Math.round((HISTORY.total / HISTORY.expected) * 1000) / 10;

  const stats = $derived([
    {
      value: String(Math.round(HISTORY.streak * count)),
      color: "var(--color-accent-ink)",
      label: "Day Streak",
    },
    {
      value: `${Math.round(HISTORY.averageAdherence * count)}%`,
      color: "var(--color-success)",
      label: "Avg Adherence",
      // Placeholder trend, as in the design.
      trend: "↑3%",
      spark: HISTORY.dailyAdherence,
    },
    {
      value: String(Math.round(HISTORY.total * count)),
      color: "var(--color-warning)",
      label: "Doses (90 days)",
      trend: "↑2%",
      spark: HISTORY.daily,
    },
  ]);

  const HEAT_COLOURS = [
    "var(--color-heatmap-0)",
    "var(--color-heatmap-1)",
    "var(--color-heatmap-2)",
    "var(--color-heatmap-3)",
    "var(--color-heatmap-4)",
  ];
  const card = "border-glass-border bg-glass rounded-xl border p-6";
  const control =
    "border-border-strong bg-surface-raised text-text-primary flex items-center gap-2 rounded-lg border text-sm whitespace-nowrap";
</script>

<div class="mx-auto flex max-w-3xl flex-col gap-6">
  <p class="text-text-muted text-xs">{DISCLAIMER_TEXT}</p>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-2xl font-bold">Analytics</p>
    <div class="{control} bg-glass! px-3 py-2 font-medium">
      All medications<Glyph name="chevron" />
    </div>
    <div class="border-glass-border bg-glass flex gap-1 rounded-lg border p-1">
      {#each ["7d", "30d", "90d", "1y"] as period (period)}
        <span
          class="rounded-md px-3 py-1.5 text-sm font-medium {period === '90d'
            ? 'bg-accent text-accent-fg'
            : 'text-text-secondary'}">{period}</span
        >
      {/each}
    </div>
    <div class="flex items-center gap-2">
      <div class="{control} px-3 py-1.5"><span>27/06/2026</span><Glyph name="calendar" /></div>
      <span class="text-text-muted text-xs">to</span>
      <div class="{control} px-3 py-1.5"><span>24/09/2026</span><Glyph name="calendar" /></div>
    </div>
  </div>

  <div use:mark={"n.stats"} class="grid grid-cols-3 gap-4">
    {#each stats as stat, i (stat.label)}
      {@const p = entrance(i)}
      <div
        class="{card} text-center"
        style:opacity={p}
        style:transform="translateY({(1 - p) * 10}px)"
      >
        <p class="text-3xl font-bold tabular-nums" style:color={stat.color}>{stat.value}</p>
        <div class="mt-1 flex items-center justify-center gap-1.5">
          <span class="text-text-secondary text-sm">{stat.label}</span>
          {#if stat.trend}<span class="text-success text-xs">{stat.trend}</span>{/if}
        </div>
        {#if stat.spark}
          <div
            class="mt-2"
            style:color={stat.color}
            style:clip-path={draw < 1
              ? `inset(0 ${((1 - draw) * 100).toFixed(2)}% 0 0)`
              : undefined}
          >
            <Sparkline values={stat.spark} height={28} />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <div class={card}>
    <p class="mb-4 text-lg font-semibold">
      <span use:mark={"n.heatTitle"}>Activity (last 90 days)</span>
    </p>
    <div use:mark={"n.heatGrid"} class="flex w-max gap-px">
      {#each HEATMAP_WEEKS as week, wi (wi)}
        {@const opacity = clamp01((heat * (HEATMAP_WEEKS.length + 2) - wi) / 2)}
        <div class="flex flex-col gap-px">
          {#each [0, 1, 2, 3, 4, 5, 6] as row (row)}
            {@const cell = week.find((c) => c.row === row)}
            {#if cell}
              <div
                class="h-[11px] w-[11px] rounded-xs"
                style:background={HEAT_COLOURS[heatmapIntensity(cell.count)]}
                style:opacity
              ></div>
            {:else}
              <div class="h-[11px] w-[11px]"></div>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <div class={card}>
    <p class="mb-4 text-lg font-semibold">Per-Medication Adherence (90 days)</p>
    <div class="flex flex-col gap-3">
      {#each MEDICATIONS as medication, i (medication.id)}
        {@const stat = HISTORY.perMedication[i]}
        {@const trend = ADHERENCE_TRENDS[medication.id]}
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <div class="h-2.5 w-2.5 rounded-full" style:background={medication.colour}></div>
              <span class="font-medium">{medication.name}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="text-text-secondary">{stat.adherence}%</span>
              {#if trend}
                <span class="text-xs {trend.up ? 'text-success' : 'text-danger-ink'}"
                  >{trend.up ? "↑" : "↓"}{trend.points}%</span
                >
              {/if}
            </div>
          </div>
          <div class="bg-glass h-2 overflow-hidden rounded-full">
            <div
              class="h-full rounded-full"
              style:width="{stat.adherence * MOTION.enter(load, 0.3 + i * 0.06, 0.6)}%"
              style:background={medication.colour}
            ></div>
          </div>
          <p class="text-text-muted text-xs">{stat.taken} / {stat.expected} doses</p>
        </div>
      {/each}
    </div>
  </div>

  <div class={card}>
    <p class="mb-4 text-lg font-semibold">Dose Status Breakdown</p>
    <div class="flex flex-col gap-2">
      <div class="bg-surface-overlay flex h-3 w-full overflow-hidden rounded-full">
        <div class="bg-success h-full" style:width="{takenPercent}%"></div>
        <div class="bg-warning h-full" style:width="{100 - takenPercent}%"></div>
      </div>
      <div class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {#each [["Taken", HISTORY.total, "bg-success"], ["Skipped", skipped, "bg-warning"], ["Missed", 0, "bg-danger"]] as [label, value, dot] (label)}
          <span class="flex items-center gap-1.5"
            ><span class="h-2 w-2 rounded-full {dot}"></span>{label} {value}</span
          >
        {/each}
        <span class="text-text-muted ml-auto">{HISTORY.expected} expected</span>
      </div>
    </div>
  </div>
</div>
