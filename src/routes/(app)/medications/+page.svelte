<script lang="ts">
  import { enhance } from '$app/forms';
  import MedicationCard from '$lib/components/MedicationCard.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Medications — MedTracker</title>
</svelte:head>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Medications</h1>
    <a
      href="/medications/new"
      class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
    >+ Add Medication</a>
  </div>

  {#if data.medications.length === 0}
    <div class="rounded-xl border border-glass-border bg-glass p-12 text-center backdrop-blur-xl">
      <p class="text-text-secondary">No medications yet.</p>
      <a href="/medications/new" class="mt-3 inline-block text-sm font-medium text-accent hover:underline">
        Add your first medication
      </a>
    </div>
  {:else}
    <div class="space-y-3">
      {#each data.medications as medication, i (medication.id)}
        <div class="flex items-center gap-2">
          <div class="flex flex-col gap-0.5">
            <form method="POST" action="?/reorder" use:enhance>
              <input type="hidden" name="medicationId" value={medication.id} />
              <input type="hidden" name="direction" value="up" />
              <button type="submit" disabled={i === 0} aria-label="Move {medication.name} up"
                class="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none">&#9650;</button>
            </form>
            <form method="POST" action="?/reorder" use:enhance>
              <input type="hidden" name="medicationId" value={medication.id} />
              <input type="hidden" name="direction" value="down" />
              <button type="submit" disabled={i === data.medications.length - 1} aria-label="Move {medication.name} down"
                class="rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 disabled:pointer-events-none">&#9660;</button>
            </form>
          </div>
          <div class="flex-1">
            <MedicationCard {medication} />
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if data.archived.length > 0}
    <details class="rounded-xl border border-glass-border bg-glass backdrop-blur-xl">
      <summary class="cursor-pointer px-5 py-4 text-sm font-medium text-text-secondary hover:text-text-primary">
        Archived ({data.archived.length})
      </summary>
      <div class="space-y-2 px-5 pb-5">
        {#each data.archived as med (med.id)}
          <a href="/medications/{med.id}" class="flex items-center gap-3 rounded-lg border border-glass-border px-4 py-3 transition-colors hover:bg-glass-hover">
            <div class="h-3 w-3 rounded-full" style="background-color: {med.colour}"></div>
            <span class="text-sm">{med.name}</span>
            <span class="ml-auto text-xs text-text-muted">View &rarr;</span>
          </a>
        {/each}
      </div>
    </details>
  {/if}
</div>
