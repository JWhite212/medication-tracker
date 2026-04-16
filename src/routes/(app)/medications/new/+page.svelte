<script lang="ts">
  import GlassCard from '$lib/components/ui/GlassCard.svelte';
  import MedicationForm from '$lib/components/MedicationForm.svelte';

  let { form } = $props();
</script>

<svelte:head>
  <title>Add Medication — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Add Medication</h1>

  <GlassCard>
    <MedicationForm
      errors={form?.errors ?? {}}
      formValues={form?.values ?? {}}
    />
  </GlassCard>
</div>
