<script lang="ts">
  import SummaryStrip from '$components/SummaryStrip.svelte';
  import QuickLogBar from '$components/QuickLogBar.svelte';
  import TimelineEntry from '$components/TimelineEntry.svelte';
  import Toast from '$components/ui/Toast.svelte';
  import Modal from '$components/ui/Modal.svelte';
  import DoseEditForm from '$components/DoseEditForm.svelte';
  import type { DoseLogWithMedication } from '$lib/types';

  let { data } = $props();
  let editingDose = $state<DoseLogWithMedication | null>(null);
</script>

<svelte:head>
  <title>Dashboard — MedTracker</title>
</svelte:head>

<Toast />

<div class="mx-auto w-full max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Dashboard</h1>

  <SummaryStrip doseCount={data.doses.length} />

  <section>
    <h2 class="mb-3 text-sm font-medium uppercase tracking-wider text-text-muted">Quick Log</h2>
    <QuickLogBar medications={data.medications} />
  </section>

  <section>
    <h2 class="mb-3 text-sm font-medium uppercase tracking-wider text-text-muted">Today</h2>
    {#if data.doses.length === 0}
      <div class="rounded-xl border border-glass-border bg-glass p-8 text-center backdrop-blur-xl">
        <p class="text-text-secondary">No doses logged today</p>
      </div>
    {:else}
      <div class="space-y-2" role="list" aria-label="Today's doses">
        {#each data.doses as dose (dose.id)}
          <TimelineEntry {dose} timezone={data.timezone} onedit={(d) => (editingDose = d)} />
        {/each}
      </div>
    {/if}
  </section>
</div>

<Modal open={editingDose !== null} onclose={() => (editingDose = null)}>
  {#if editingDose}
    <DoseEditForm dose={editingDose} onclose={() => (editingDose = null)} />
  {/if}
</Modal>
