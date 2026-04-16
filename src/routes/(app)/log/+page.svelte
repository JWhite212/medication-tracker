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

  function formatDateKey(date: Date, tz: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }

  function formatDateLabel(dateKey: string, todayKey: string, yesterdayKey: string): string {
    if (dateKey === todayKey) return 'Today';
    if (dateKey === yesterdayKey) return 'Yesterday';

    const [y, m, d] = dateKey.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  }

  const groupedDoses = $derived.by(() => {
    const now = new Date();
    const todayKey = formatDateKey(now, data.timezone);
    const yesterdayKey = formatDateKey(new Date(now.getTime() - 86400000), data.timezone);
    const groups: Array<{ dateKey: string; label: string; doses: typeof data.doses }> = [];
    const map = new Map<string, typeof data.doses>();
    for (const dose of data.doses) {
      const key = formatDateKey(new Date(dose.takenAt), data.timezone);
      const existing = map.get(key);
      if (existing) {
        existing.push(dose);
      } else {
        const arr = [dose];
        map.set(key, arr);
      }
    }
    for (const [dateKey, doses] of map) {
      groups.push({ dateKey, label: formatDateLabel(dateKey, todayKey, yesterdayKey), doses });
    }
    return groups;
  });
</script>

<svelte:head>
  <title>Dose History — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Dose History</h1>

  <div class="flex flex-col gap-2 rounded-xl border border-glass-border bg-glass p-4 backdrop-blur-xl sm:flex-row sm:flex-wrap sm:gap-3">
    <select
      class="w-full rounded-lg border border-glass-border bg-surface-raised px-3 py-2 text-sm text-text-primary sm:w-auto"
      onchange={(e) => updateFilter('medication', e.currentTarget.value)}
    >
      <option value="">All medications</option>
      {#each data.medications as med}
        <option value={med.id} selected={med.id === data.filters.medication}>{med.name}</option>
      {/each}
    </select>
    <input type="date" class="w-full rounded-lg border border-glass-border bg-surface-raised px-3 py-2 text-sm text-text-primary sm:w-auto"
      value={data.filters.from ?? ''} onchange={(e) => updateFilter('from', e.currentTarget.value)} />
    <span class="self-center text-text-muted">to</span>
    <input type="date" class="w-full rounded-lg border border-glass-border bg-surface-raised px-3 py-2 text-sm text-text-primary sm:w-auto"
      value={data.filters.to ?? ''} onchange={(e) => updateFilter('to', e.currentTarget.value)} />
  </div>

  {#if data.doses.length === 0}
    <div class="rounded-xl border border-glass-border bg-glass p-8 text-center backdrop-blur-xl">
      <p class="text-text-secondary">No doses found for these filters</p>
    </div>
  {:else}
    <div role="list">
      {#each groupedDoses as group (group.dateKey)}
        <div class="sticky top-0 z-10 -mx-1 px-1 py-2 bg-surface/80 backdrop-blur-sm">
          <h3 class="text-sm font-medium text-text-secondary">{group.label}</h3>
        </div>
        <div class="space-y-2 pb-4">
          {#each group.doses as dose (dose.id)}
            <TimelineEntry {dose} timezone={data.timezone} onedit={(d) => (editingDose = d)} />
          {/each}
        </div>
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
