<script lang="ts">
  import { tick } from "svelte";
  import { enhance } from "$app/forms";
  import MedicationCard from "$lib/components/MedicationCard.svelte";
  import EmptyState from "$components/EmptyState.svelte";
  import emptyMedications from "$lib/assets/397d3a76-85b0-43ee-a0c2-981053e4040c.webp";

  let { data } = $props();

  let announcement = $state("");

  /**
   * Reordering succeeded silently: the list re-rendered with no announcement,
   * and when an item reached either end its own button became `disabled`, which
   * makes the browser drop focus to <body> — so a keyboard user lost both the
   * result and their place, mid-task.
   */
  function reorder(medication: { id: string; name: string }, direction: "up" | "down") {
    return () =>
      async ({ update }: { update: () => Promise<void> }) => {
        await update();
        const index = data.medications.findIndex((m: { id: string }) => m.id === medication.id);
        announcement = `${medication.name} moved to position ${index + 1} of ${data.medications.length}`;
        await tick();
        const same = document.getElementById(`move-${medication.id}-${direction}`);
        const opposite = document.getElementById(
          `move-${medication.id}-${direction === "up" ? "down" : "up"}`,
        );
        // Prefer the button just pressed; fall back to its sibling when the move
        // disabled it.
        const target = same && !(same as HTMLButtonElement).disabled ? same : opposite;
        target?.focus();
      };
  }
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
    <EmptyState
      illustration={emptyMedications}
      illustrationAlt="No medications yet — add your first medication to start tracking doses"
      title="No medications yet"
      body="Add a medication to start tracking doses, set reminders, and view adherence."
      action={{ href: "/medications/new", label: "+ Add your first medication" }}
    />
  {:else}
    <p class="sr-only" role="status">{announcement}</p>
    <div class="space-y-3">
      {#each data.medications as medication, i (medication.id)}
        <div class="flex items-center gap-2">
          <div class="flex flex-col gap-0.5">
            <form method="POST" action="?/reorder" use:enhance={reorder(medication, "up")}>
              <input type="hidden" name="medicationId" value={medication.id} />
              <input type="hidden" name="direction" value="up" />
              <button
                type="submit"
                id="move-{medication.id}-up"
                disabled={i === 0}
                aria-label="Move {medication.name} up"
                class="text-text-muted hover:bg-surface-overlay hover:text-text-primary rounded-xs px-1.5 py-0.5 text-xs disabled:pointer-events-none disabled:opacity-30"
              >
                <span aria-hidden="true">&#9650;</span>
              </button>
            </form>
            <form method="POST" action="?/reorder" use:enhance={reorder(medication, "down")}>
              <input type="hidden" name="medicationId" value={medication.id} />
              <input type="hidden" name="direction" value="down" />
              <button
                type="submit"
                id="move-{medication.id}-down"
                disabled={i === data.medications.length - 1}
                aria-label="Move {medication.name} down"
                class="text-text-muted hover:bg-surface-overlay hover:text-text-primary rounded-xs px-1.5 py-0.5 text-xs disabled:pointer-events-none disabled:opacity-30"
              >
                <span aria-hidden="true">&#9660;</span>
              </button>
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
            class="border-glass-border hover:bg-surface-overlay flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors"
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
