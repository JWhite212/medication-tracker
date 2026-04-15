<script lang="ts">
  import GlassCard from '$lib/components/ui/GlassCard.svelte';
  import MedicationForm from '$lib/components/MedicationForm.svelte';

  let { data, form } = $props();
</script>

<div class="mx-auto max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Edit {data.medication.name}</h1>

  <GlassCard>
    <MedicationForm
      medication={data.medication}
      errors={form?.errors ?? {}}
      formValues={form?.values ?? {}}
    />
  </GlassCard>

  <GlassCard>
    <div class="flex items-center justify-between">
      <div>
        <p class="font-medium">Archive Medication</p>
        <p class="text-sm text-text-secondary">Remove this medication from your active list.</p>
      </div>
      <form method="POST" action="?/archive">
        <button
          type="submit"
          class="rounded-lg border border-danger px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
        >
          Archive
        </button>
      </form>
    </div>
  </GlassCard>
</div>
