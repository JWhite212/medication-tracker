<script lang="ts">
  import type { Medication } from '$lib/types';
  let { medication }: { medication: Medication } = $props();
</script>

<a href="/medications/{medication.id}"
  class="flex items-center gap-4 rounded-xl border border-glass-border bg-glass p-4 backdrop-blur-xl transition-colors hover:bg-glass-hover">
  <div class="h-10 w-10 rounded-lg" style="background-color: {medication.colour}"></div>
  <div class="min-w-0 flex-1">
    <p class="font-medium">{medication.name}</p>
    <p class="text-sm text-text-secondary">
      {medication.dosageAmount}{medication.dosageUnit} &middot; {medication.form}
      <span class="ml-2 rounded-full bg-glass px-2 py-0.5 text-xs">{medication.category}</span>
    </p>
  </div>
  {#if medication.inventoryCount !== null && medication.inventoryAlertThreshold !== null && medication.inventoryCount <= medication.inventoryAlertThreshold}
    <span class="rounded-full bg-warning/15 px-2 py-1 text-xs font-medium text-warning">Low: {medication.inventoryCount}</span>
  {/if}
</a>
