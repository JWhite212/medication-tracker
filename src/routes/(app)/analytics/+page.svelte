<script lang="ts">
  import GlassCard from "$components/ui/GlassCard.svelte";
  import Heatmap from "$components/Heatmap.svelte";
  import AdherenceChart from "$components/AdherenceChart.svelte";
  import Sparkline from "$components/Sparkline.svelte";
  import InsightsCard from "$components/InsightsCard.svelte";
  import StatusBreakdownBar from "$components/StatusBreakdownBar.svelte";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";
  import { goto } from "$app/navigation";

  let { data } = $props();

  const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKEND_DOW = new Set([0, 6]);

  const maxDayCount = $derived(
    Math.max(...data.dayOfWeek.map((d: { count: number }) => d.count), 1),
  );
  const maxHourCount = $derived(Math.max(...data.hourly.map((h: { count: number }) => h.count), 1));
  const PERIODS = [
    { value: 7, label: "7d" },
    { value: 30, label: "30d" },
    { value: 90, label: "90d" },
    { value: 365, label: "1y" },
  ] as const;

  function periodLabel(days: number): string {
    return days === 365 ? "1 year" : `${days} days`;
  }

  function setPeriod(value: number) {
    const url = new URL(window.location.href);
    url.searchParams.set("period", String(value));
    url.searchParams.delete("from");
    url.searchParams.delete("to");
    goto(url.toString(), { invalidateAll: true });
  }

  function setDateRange(key: string, value: string) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    goto(url.toString(), { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>Analytics — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <MedicalDisclaimer variant="inline" />

  <InsightsCard insights={data.insights} />

  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <h1 class="text-2xl font-bold">Analytics</h1>
    <div class="border-glass-border bg-glass flex gap-1 rounded-lg border p-1 backdrop-blur-xl">
      {#each PERIODS as p}
        <button
          class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors {data.period ===
          p.value
            ? 'bg-accent text-white'
            : 'text-text-secondary hover:text-text-primary'}"
          onclick={() => setPeriod(p.value)}
        >
          {p.label}
        </button>
      {/each}
    </div>
    <div class="flex items-center gap-2">
      <input
        type="date"
        value={data.from}
        onchange={(e) => setDateRange("from", e.currentTarget.value)}
        class="border-glass-border bg-surface-raised text-text-primary rounded-lg border px-3 py-1.5 text-sm"
      />
      <span class="text-text-muted text-xs">to</span>
      <input
        type="date"
        value={data.to}
        onchange={(e) => setDateRange("to", e.currentTarget.value)}
        class="border-glass-border bg-surface-raised text-text-primary rounded-lg border px-3 py-1.5 text-sm"
      />
    </div>
  </div>

  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:gap-4">
    <GlassCard class="animate-fade-in-up text-center" style="animation-delay: 0ms">
      <p class="text-accent text-3xl font-bold">{data.streak}</p>
      <p class="text-text-secondary mt-1 text-sm">Day Streak</p>
    </GlassCard>
    <GlassCard class="animate-fade-in-up text-center" style="animation-delay: 80ms">
      <p class="text-success text-3xl font-bold">
        {data.avgAdherence}%
      </p>
      <div class="mt-1 flex items-center justify-center gap-1.5">
        <span class="text-text-secondary text-sm">Avg Adherence</span>
        {#if data.trends.adherence.direction !== "flat"}
          <span
            class="text-xs {data.trends.adherence.direction === 'up'
              ? 'text-success'
              : 'text-danger'}"
          >
            {data.trends.adherence.direction === "up" ? "\u2191" : "\u2193"}{data.trends.adherence
              .percent}%
          </span>
        {/if}
      </div>
      {#if data.dailyAdherence.length > 1}
        <div class="text-success mt-2">
          <Sparkline
            values={data.dailyAdherence.map((d) => d.adherence)}
            color="currentColor"
            height={28}
            ariaLabel="Daily adherence over period"
          />
        </div>
      {/if}
    </GlassCard>
    <GlassCard class="animate-fade-in-up text-center" style="animation-delay: 160ms">
      <p class="text-warning text-3xl font-bold">
        {data.totalDoses}
      </p>
      <div class="mt-1 flex items-center justify-center gap-1.5">
        <span class="text-text-secondary text-sm">Doses ({periodLabel(data.period)})</span>
        {#if data.trends.doses.direction !== "flat"}
          <span
            class="text-xs {data.trends.doses.direction === 'up' ? 'text-success' : 'text-danger'}"
          >
            {data.trends.doses.direction === "up" ? "\u2191" : "\u2193"}{data.trends.doses.percent}%
          </span>
        {/if}
      </div>
      {#if data.dailyAdherence.length > 1}
        <div class="text-warning mt-2">
          <Sparkline
            values={data.dailyAdherence.map((d) => d.doseCount)}
            color="currentColor"
            height={28}
            ariaLabel="Daily doses over period"
          />
        </div>
      {/if}
    </GlassCard>
  </div>

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Activity (last {periodLabel(data.period)})</h2>
    <Heatmap data={data.dailyCounts} days={data.period} />
  </GlassCard>

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">
      Per-Medication Adherence ({periodLabel(data.period)})
    </h2>
    {#if data.medStats.length > 0}
      <AdherenceChart stats={data.medStats} trends={data.trends.perMedication} />
    {:else}
      <p class="text-text-secondary">No data yet</p>
    {/if}
  </GlassCard>

  {#if data.statusBreakdown.expectedTotal > 0 || data.statusBreakdown.skippedEvents > 0}
    <GlassCard>
      <h2 class="mb-4 text-lg font-semibold">Dose Status Breakdown</h2>
      <StatusBreakdownBar
        takenEvents={data.statusBreakdown.takenEvents}
        skippedEvents={data.statusBreakdown.skippedEvents}
        missedEvents={data.statusBreakdown.missedEvents}
        expectedTotal={data.statusBreakdown.expectedTotal}
      />
    </GlassCard>
  {/if}

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Day of Week Distribution</h2>
    <div class="overflow-x-auto">
      <div class="flex h-32 gap-2" style="min-width: 20rem">
        {#each Array.from({ length: 7 }, (_, i) => i) as dow}
          {@const count =
            data.dayOfWeek.find((d: { dayOfWeek: number }) => d.dayOfWeek === dow)?.count ?? 0}
          <div class="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div
              class="w-full rounded-t transition-all {WEEKEND_DOW.has(dow)
                ? 'bg-accent/40'
                : 'bg-accent/70'}"
              style="height: {(count / maxDayCount) * 100}%"
              title="{DAY_LABELS[dow]}: {count}"
            ></div>
            <span class="text-text-muted text-[10px]">{DAY_LABELS[dow]}</span>
          </div>
        {/each}
      </div>
    </div>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">Time of Day Distribution</h2>
    {#if data.scheduledHours.length > 0}
      <p class="text-text-muted mb-3 text-xs">
        Triangles mark scheduled times{data.scheduleVariance
          ? `. Avg ${data.scheduleVariance.avgMinutesOff} min off-schedule (fixed-time meds, n=${data.scheduleVariance.sampleSize})`
          : ""}
      </p>
    {/if}
    <div class="overflow-x-auto">
      <div class="flex h-36 gap-1" style="min-width: 28rem">
        {#each Array.from({ length: 24 }, (_, i) => i) as hour}
          {@const count = data.hourly.find((h: { hour: number }) => h.hour === hour)?.count ?? 0}
          {@const scheduled = data.scheduledHours.includes(hour)}
          <div class="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <div class="text-accent flex h-3 items-end text-[10px] leading-none">
              {scheduled ? "▼" : ""}
            </div>
            <div
              class="bg-accent/70 w-full rounded-t transition-all"
              style="height: {(count / maxHourCount) * 100}%"
              title="{hour.toString().padStart(2, '0')}:00 — {count}{scheduled
                ? ' (scheduled)'
                : ''}"
            ></div>
            {#if hour % 6 === 0}
              <span class="text-text-muted text-[10px]">{hour}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </GlassCard>

  {#if data.sideEffects.frequency.length > 0}
    <GlassCard>
      <h2 class="mb-4 text-lg font-semibold">Side Effects</h2>
      <div class="space-y-2">
        {#each data.sideEffects.frequency as effect}
          {@const maxCount = data.sideEffects.frequency[0].count}
          <div class="flex items-center gap-3">
            <span class="w-28 truncate text-sm">{effect.name}</span>
            <div class="bg-surface-overlay h-4 flex-1 overflow-hidden rounded-full">
              <div
                class="bg-warning/70 h-full rounded-full"
                style="width: {(effect.count / maxCount) * 100}%"
              ></div>
            </div>
            <span class="text-text-muted w-8 text-right text-xs">{effect.count}</span>
          </div>
        {/each}
      </div>

      {#if data.sideEffects.byMedication.length > 0}
        <h3 class="text-text-secondary mt-6 mb-2 text-sm font-medium">By Medication</h3>
        <div class="space-y-3">
          {#each data.sideEffects.byMedication as med}
            <div>
              <p class="text-sm font-medium">{med.medication}</p>
              <div class="mt-1 flex flex-wrap gap-1.5">
                {#each med.effects as eff}
                  <span class="bg-warning/10 text-warning rounded-full px-2.5 py-0.5 text-xs"
                    >{eff.name} ({eff.count})</span
                  >
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </GlassCard>
  {/if}
</div>
