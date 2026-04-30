<script lang="ts">
  import type { MedicationWithStats } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import TimeSince from "$components/TimeSince.svelte";
  import Sparkline from "$components/Sparkline.svelte";

  let { medication }: { medication: MedicationWithStats } = $props();

  function refillChipClass(severity: MedicationWithStats["refillSeverity"]): string {
    if (severity === "critical") return "bg-danger/15 text-danger";
    if (severity === "warning") return "bg-warning/15 text-warning";
    if (severity === "watch") return "bg-accent/15 text-accent";
    return "";
  }

  const isScheduled = $derived(medication.scheduleType === "scheduled");
  const scheduleHours = $derived(
    medication.scheduleIntervalHours ? Number(medication.scheduleIntervalHours) : 24,
  );
  const expectedWeeklyDoses = $derived(Math.round((7 * 24) / scheduleHours));
  const adherencePercent = $derived(
    isScheduled && expectedWeeklyDoses > 0
      ? Math.min(100, Math.round((medication.weeklyDoseCount / expectedWeeklyDoses) * 100))
      : 0,
  );

  let logging = $state(false);

  async function quickLog(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    logging = true;
    try {
      const form = new FormData();
      form.set("medicationId", medication.id);
      form.set("quantity", "1");
      await fetch("/dashboard?/logDose", { method: "POST", body: form });
    } finally {
      logging = false;
    }
  }
</script>

<div
  class="group border-glass-border bg-glass hover:bg-glass-hover relative rounded-xl border backdrop-blur-xl transition-colors"
>
  <a href="/medications/{medication.id}" class="block p-4">
    <div class="flex items-center gap-4">
      <div
        class="h-10 w-10 shrink-0 rounded-lg"
        style="background: {getMedicationBackground(
          medication.colour,
          medication.colourSecondary,
          medication.pattern,
        )}"
      ></div>
      <div class="min-w-0 flex-1">
        <p class="font-medium">{medication.name}</p>
        <p class="text-text-secondary text-sm">
          {medication.dosageAmount}{medication.dosageUnit} &middot; {medication.form}
          <span class="bg-glass ml-2 rounded-full px-2 py-0.5 text-xs">{medication.category}</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {#if medication.refillSeverity && medication.refillSeverity !== "ok"}
          <span
            class="rounded-full px-2 py-1 text-xs font-medium {refillChipClass(
              medication.refillSeverity,
            )}"
          >
            {medication.daysUntilRefill ?? 0}d left
          </span>
        {:else if medication.inventoryCount !== null && medication.inventoryAlertThreshold !== null && medication.inventoryCount <= medication.inventoryAlertThreshold}
          <span class="bg-warning/15 text-warning rounded-full px-2 py-1 text-xs font-medium"
            >Low: {medication.inventoryCount}</span
          >
        {/if}
      </div>
    </div>

    <!-- Stats row -->
    <div class="text-text-secondary mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {#if medication.lastTakenAt}
        <span>Last taken: <TimeSince date={medication.lastTakenAt} /></span>
      {:else}
        <span>Never taken</span>
      {/if}

      {#if medication.daysUntilRefill !== null}
        <span class={medication.daysUntilRefill <= 7 ? "text-warning" : ""}>
          ~{medication.daysUntilRefill}d supply left
        </span>
      {/if}
    </div>

    <!-- Adherence mini-bar (scheduled meds only) -->
    {#if isScheduled}
      <div class="mt-2 flex items-center gap-2">
        <div class="bg-glass h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            class="h-full rounded-full transition-all"
            style="width: {adherencePercent}%; background: {medication.colour}"
          ></div>
        </div>
        <span class="text-text-muted shrink-0 text-xs tabular-nums">{adherencePercent}%</span>
      </div>
    {/if}

    {#if medication.sparkline && medication.sparkline.length > 1}
      <div class="text-text-muted mt-2 flex items-center gap-2">
        <span class="text-[10px] tracking-wider uppercase">14d</span>
        <div class="flex-1" style="color: {medication.colour}">
          <Sparkline
            values={medication.sparkline}
            color="currentColor"
            height={20}
            ariaLabel="14-day dose count for {medication.name}"
          />
        </div>
      </div>
    {/if}
  </a>

  <!-- Quick log button -->
  <button
    type="button"
    class="bg-glass text-text-secondary hover:bg-accent hover:text-accent-fg absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg opacity-0 transition-all group-hover:opacity-100"
    aria-label="Quick log {medication.name}"
    disabled={logging}
    onclick={quickLog}
  >
    {#if logging}
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      ></span>
    {:else}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="h-4 w-4"
      >
        <path
          d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"
        />
      </svg>
    {/if}
  </button>
</div>
