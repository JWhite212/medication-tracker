<script lang="ts">
  import Input from "$lib/components/ui/Input.svelte";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

  let {
    dosageAmount,
    dosageUnit,
    errors,
  }: {
    dosageAmount: string;
    dosageUnit: string;
    errors: FormErrors;
  } = $props();
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
  <Input
    label="Dosage Amount"
    name="dosageAmount"
    value={dosageAmount}
    error={errors["dosageAmount"]?.[0] ?? ""}
    required
    placeholder="e.g. 500"
  />
  <Input
    label="Dosage Unit"
    name="dosageUnit"
    value={dosageUnit}
    error={errors["dosageUnit"]?.[0] ?? ""}
    required
    placeholder="e.g. mg"
  />
</div>
