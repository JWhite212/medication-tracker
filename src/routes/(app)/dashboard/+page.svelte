<script lang="ts">
  import { enhance } from "$app/forms";
  import SummaryStrip from "$components/SummaryStrip.svelte";
  import MyDayTimeline from "$components/MyDayTimeline.svelte";
  import QuickLogBar from "$components/QuickLogBar.svelte";
  import TimelineEntry from "$components/TimelineEntry.svelte";
  import OnboardingWelcome from "$components/OnboardingWelcome.svelte";
  import Toast from "$components/ui/Toast.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import DoseEditForm from "$components/DoseEditForm.svelte";
  import KeyboardShortcuts from "$components/KeyboardShortcuts.svelte";
  import type { DoseLogWithMedication } from "$lib/types";
  import { formatDueIn } from "$lib/utils/time";
  import { getMedicationBackground } from "$lib/utils/medication-style";

  let { data } = $props();
  let editingDose = $state<DoseLogWithMedication | null>(null);

  const overdueCount = $derived(data.timingStatus.filter((t) => t.status === "overdue").length);

  const overdueMeds = $derived(
    data.timingStatus
      .filter((t) => t.status === "overdue")
      .map((t) => {
        const med = data.medications.find((m) => m.id === t.medicationId);
        return med ? { ...t, medication: med } : null;
      })
      .filter(Boolean) as Array<
      (typeof data.timingStatus)[number] & { medication: (typeof data.medications)[number] }
    >,
  );
</script>

<svelte:head>
  <title>Dashboard — MedTracker</title>
</svelte:head>

<Toast />

{#if data.medications.length === 0}
  <OnboardingWelcome />
{:else}
  <div class="mx-auto w-full max-w-2xl space-y-6">
    <h1 class="text-2xl font-bold">Dashboard</h1>

    <SummaryStrip doseCount={data.doses.length} {overdueCount} />

    <MyDayTimeline
      scheduleSlots={data.scheduleSlots}
      timezone={data.timezone}
      timeFormat={data.preferences.timeFormat as "12h" | "24h"}
    />

    <section>
      <h2 class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Quick Log</h2>
      <QuickLogBar medications={data.medications} timingStatus={data.timingStatus} />
    </section>

    <section>
      <h2 class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Today</h2>

      {#if overdueMeds.length > 0}
        <div class="mb-2 space-y-2" role="list" aria-label="Overdue medications">
          {#each overdueMeds as entry (entry.medicationId)}
            <div
              class="border-warning/40 bg-warning/5 flex items-center gap-4 rounded-lg border border-dashed p-4 opacity-60"
              role="listitem"
            >
              <div
                class="h-3 w-3 shrink-0 rounded-full"
                style="background: {getMedicationBackground(
                  entry.medication.colour,
                  entry.medication.colourSecondary,
                  entry.medication.pattern,
                  true,
                )}"
              ></div>
              <div class="min-w-0 flex-1">
                <p class="text-text-secondary font-medium">
                  {entry.medication.name}
                  <span class="text-text-muted text-sm">
                    {entry.medication.dosageAmount}{entry.medication.dosageUnit}
                  </span>
                </p>
              </div>
              <span class="text-warning text-xs font-medium">
                {formatDueIn(entry.minutesUntilDue * 60_000)}
              </span>
              <form method="POST" action="?/skipDose" use:enhance>
                <input type="hidden" name="medicationId" value={entry.medicationId} />
                <button
                  type="submit"
                  class="text-text-muted hover:bg-glass-hover hover:text-text-primary rounded px-2 py-1 text-xs transition-colors"
                >
                  Skip
                </button>
              </form>
            </div>
          {/each}
        </div>
      {/if}

      {#if data.doses.length === 0 && overdueMeds.length === 0}
        <div
          class="border-glass-border bg-glass rounded-xl border p-8 text-center backdrop-blur-xl"
        >
          <p class="text-text-secondary">No doses logged today</p>
        </div>
      {:else if data.doses.length > 0}
        <div class="space-y-2" role="list" aria-label="Today's doses">
          {#each data.doses as dose (dose.id)}
            <TimelineEntry
              {dose}
              timezone={data.timezone}
              timeFormat={data.preferences.timeFormat as "12h" | "24h"}
              onedit={(d) => (editingDose = d)}
            />
          {/each}
        </div>
      {/if}
    </section>
  </div>
{/if}

<Modal open={editingDose !== null} onclose={() => (editingDose = null)}>
  {#if editingDose}
    <DoseEditForm dose={editingDose} onclose={() => (editingDose = null)} />
  {/if}
</Modal>

<KeyboardShortcuts medications={data.medications} />
