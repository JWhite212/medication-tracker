<script lang="ts">
  import { enhance } from "$app/forms";
  import MedicationCard from "$lib/components/MedicationCard.svelte";
  import emptyMedications from "$lib/assets/397d3a76-85b0-43ee-a0c2-981053e4040c.png";

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
      class="bg-accent text-accent-fg rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
      >+ Add Medication</a
    >
  </div>

  {#if data.medications.length === 0}
    <div
      class="border-glass-border bg-glass flex flex-col items-center rounded-xl border p-8 text-center backdrop-blur-xl sm:p-12"
    >
      <img
        src={emptyMedications}
        alt="No medications yet — add your first medication to start tracking doses"
        width="320"
        height="240"
        class="w-full max-w-xs"
      />
      <a
        href="/medications/new"
        class="bg-accent text-accent-fg mt-4 rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        + Add your first medication
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
              <button
                type="submit"
                disabled={i === 0}
                aria-label="Move {medication.name} up"
                class="text-text-muted hover:bg-glass-hover hover:text-text-primary rounded px-1.5 py-0.5 text-xs disabled:pointer-events-none disabled:opacity-30"
                >&#9650;</button
              >
            </form>
            <form method="POST" action="?/reorder" use:enhance>
              <input type="hidden" name="medicationId" value={medication.id} />
              <input type="hidden" name="direction" value="down" />
              <button
                type="submit"
                disabled={i === data.medications.length - 1}
                aria-label="Move {medication.name} down"
                class="text-text-muted hover:bg-glass-hover hover:text-text-primary rounded px-1.5 py-0.5 text-xs disabled:pointer-events-none disabled:opacity-30"
                >&#9660;</button
              >
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
    <details class="border-glass-border bg-glass rounded-xl border backdrop-blur-xl">
      <summary
        class="text-text-secondary hover:text-text-primary cursor-pointer px-5 py-4 text-sm font-medium"
      >
        Archived ({data.archived.length})
      </summary>
      <div class="space-y-2 px-5 pb-5">
        {#each data.archived as med (med.id)}
          <a
            href="/medications/{med.id}"
            class="border-glass-border hover:bg-glass-hover flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
          >
            <div class="h-3 w-3 rounded-full" style="background-color: {med.colour}"></div>
            <span class="text-sm">{med.name}</span>
            <span class="text-text-muted ml-auto text-xs">View &rarr;</span>
          </a>
        {/each}
      </div>
    </details>
  {/if}
</div>
