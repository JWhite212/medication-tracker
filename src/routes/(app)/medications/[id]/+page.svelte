<script lang="ts">
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import MedicationForm from "$lib/components/MedicationForm.svelte";

  let { data, form } = $props();
</script>

<svelte:head>
  <title>Edit {data.medication.name} — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Edit {data.medication.name}</h1>

  <GlassCard>
    <MedicationForm
      medication={data.medication}
      schedules={data.schedules}
      errors={form?.errors ?? {}}
      formValues={(form?.values ?? {}) as Record<string, string>}
    />
  </GlassCard>

  <GlassCard>
    <div class="flex items-center justify-between">
      {#if data.medication.isArchived}
        <div>
          <p class="font-medium">Archived Medication</p>
          <p class="text-text-secondary text-sm">Restore this medication to your active list.</p>
        </div>
        <form method="POST" action="?/unarchive">
          <button
            type="submit"
            class="border-accent text-accent hover:bg-accent/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Unarchive
          </button>
        </form>
      {:else}
        <div>
          <p class="font-medium">Archive Medication</p>
          <p class="text-text-secondary text-sm">Remove this medication from your active list.</p>
        </div>
        <form method="POST" action="?/archive">
          <button
            type="submit"
            class="border-danger text-danger hover:bg-danger/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Archive
          </button>
        </form>
      {/if}
    </div>
  </GlassCard>
</div>
