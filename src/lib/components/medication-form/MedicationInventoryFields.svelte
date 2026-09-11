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
    <!-- The Tooltip sits beside the <label>, not inside it. A button within a
         label contributes its own accessible name to the labelled control, so
         this input used to compute as "Inventory Count More info". -->
    <div class="mb-1 flex items-center text-sm font-medium">
      <label for="inventoryCount">Inventory Count</label>
      <Tooltip
        label="Inventory Count"
        text="Track how many doses you have left. Automatically decreases when you log a dose."
      />
    </div>
    <input
      id="inventoryCount"
      name="inventoryCount"
      type="number"
      value={inventoryCount}
      placeholder="e.g. 30"
      aria-invalid={errors["inventoryCount"]?.[0] ? "true" : undefined}
      aria-describedby={errors["inventoryCount"]?.[0] ? "inventoryCount-error" : undefined}
      class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if errors["inventoryCount"]?.[0]}<p
        id="inventoryCount-error"
        class="text-danger-ink mt-1 text-sm"
        role="alert"
      >
        {errors["inventoryCount"][0]}
      </p>{/if}
  </div>
  <div>
    <div class="mb-1 flex items-center text-sm font-medium">
      <label for="inventoryAlertThreshold">Low Stock Alert Threshold</label>
      <Tooltip
        label="Low Stock Alert Threshold"
        text="You'll see a warning when your remaining inventory drops to this number."
      />
    </div>
    <input
      id="inventoryAlertThreshold"
      name="inventoryAlertThreshold"
      type="number"
      value={inventoryAlertThreshold}
      placeholder="e.g. 7"
      aria-invalid={errors["inventoryAlertThreshold"]?.[0] ? "true" : undefined}
      aria-describedby={errors["inventoryAlertThreshold"]?.[0]
        ? "inventoryAlertThreshold-error"
        : undefined}
      class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if errors["inventoryAlertThreshold"]?.[0]}<p
        id="inventoryAlertThreshold-error"
        class="text-danger-ink mt-1 text-sm"
        role="alert"
      >
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
    aria-invalid={errors["notes"]?.[0] ? "true" : undefined}
    aria-describedby={errors["notes"]?.[0] ? "notes-error" : undefined}
    class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >{notes}</textarea
  >
  {#if errors["notes"]?.[0]}<p id="notes-error" class="text-danger-ink mt-1 text-sm" role="alert">
      {errors["notes"][0]}
    </p>{/if}
</div>
