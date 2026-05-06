<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

  let {
    inventoryCount,
    inventoryAlertThreshold,
    notes,
    errors,
  }: {
    inventoryCount: string;
    inventoryAlertThreshold: string;
    notes: string;
    errors: FormErrors;
  } = $props();
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
  <div>
    <label for="inventoryCount" class="mb-1 block text-sm font-medium">
      Inventory Count
      <Tooltip
        text="Track how many doses you have left. Automatically decreases when you log a dose."
      />
    </label>
    <input
      id="inventoryCount"
      name="inventoryCount"
      type="number"
      value={inventoryCount}
      placeholder="e.g. 30"
      class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if errors["inventoryCount"]?.[0]}<p class="text-danger mt-1 text-sm">
        {errors["inventoryCount"][0]}
      </p>{/if}
  </div>
  <div>
    <label for="inventoryAlertThreshold" class="mb-1 block text-sm font-medium">
      Low Stock Alert Threshold
      <Tooltip text="You'll see a warning when your remaining inventory drops to this number." />
    </label>
    <input
      id="inventoryAlertThreshold"
      name="inventoryAlertThreshold"
      type="number"
      value={inventoryAlertThreshold}
      placeholder="e.g. 7"
      class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if errors["inventoryAlertThreshold"]?.[0]}<p class="text-danger mt-1 text-sm">
        {errors["inventoryAlertThreshold"][0]}
      </p>{/if}
  </div>
</div>

<div>
  <label for="notes" class="mb-1 block text-sm font-medium">Notes</label>
  <textarea
    id="notes"
    name="notes"
    rows="3"
    placeholder="Optional notes..."
    class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >{notes}</textarea
  >
  {#if errors["notes"]?.[0]}<p class="text-danger mt-1 text-sm">{errors["notes"][0]}</p>{/if}
</div>
