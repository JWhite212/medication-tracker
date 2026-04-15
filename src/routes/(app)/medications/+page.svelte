<script lang="ts">
  import MedicationCard from '$lib/components/MedicationCard.svelte';

  let { data } = $props();
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-bold">Medications</h1>
    <a
      href="/medications/new"
      class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
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
      {#each data.medications as medication (medication.id)}
        <MedicationCard {medication} />
      {/each}
    </div>
  {/if}
</div>
