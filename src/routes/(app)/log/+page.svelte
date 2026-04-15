<script lang="ts">
  import TimelineEntry from '$components/TimelineEntry.svelte';
  import Modal from '$components/ui/Modal.svelte';
  import DoseEditForm from '$components/DoseEditForm.svelte';
  import { goto } from '$app/navigation';
  import type { DoseLogWithMedication } from '$lib/types';

  let { data } = $props();
  let editingDose = $state<DoseLogWithMedication | null>(null);

  function updateFilter(key: string, value: string) {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    url.searchParams.set('page', '1');
    goto(url.toString(), { invalidateAll: true });
  }
</script>

<svelte:head>
  <title>Dose History — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Dose History</h1>

  <div class="flex flex-wrap gap-3 rounded-xl border border-glass-border bg-glass p-4 backdrop-blur-xl">
    <select
      class="rounded-lg border border-glass-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
      onchange={(e) => updateFilter('medication', e.currentTarget.value)}
    >
      <option value="">All medications</option>
      {#each data.medications as med}
        <option value={med.id} selected={med.id === data.filters.medication}>{med.name}</option>
      {/each}
    </select>
    <input type="date" class="rounded-lg border border-glass-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
      value={data.filters.from ?? ''} onchange={(e) => updateFilter('from', e.currentTarget.value)} />
    <span class="self-center text-text-muted">to</span>
    <input type="date" class="rounded-lg border border-glass-border bg-surface-raised px-3 py-2 text-sm text-text-primary"
      value={data.filters.to ?? ''} onchange={(e) => updateFilter('to', e.currentTarget.value)} />
  </div>

  {#if data.doses.length === 0}
    <div class="rounded-xl border border-glass-border bg-glass p-8 text-center backdrop-blur-xl">
      <p class="text-text-secondary">No doses found for these filters</p>
    </div>
  {:else}
    <div class="space-y-2" role="list">
      {#each data.doses as dose (dose.id)}
        <TimelineEntry {dose} timezone={data.timezone} onedit={(d) => (editingDose = d)} />
      {/each}
    </div>
  {/if}

  <div class="flex justify-between">
    {#if data.page > 1}
      <a href="?page={data.page - 1}" class="rounded-lg border border-glass-border px-4 py-2 text-sm hover:bg-glass-hover">Previous</a>
    {:else}<div></div>{/if}
    {#if data.hasMore}
      <a href="?page={data.page + 1}" class="rounded-lg border border-glass-border px-4 py-2 text-sm hover:bg-glass-hover">Next</a>
    {/if}
  </div>
</div>

<Modal open={editingDose !== null} onclose={() => (editingDose = null)}>
  {#if editingDose}
    <DoseEditForm dose={editingDose} onclose={() => (editingDose = null)} />
  {/if}
</Modal>
