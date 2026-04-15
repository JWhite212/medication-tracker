<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Medication } from '$lib/types';
  import { showToast } from '$components/ui/Toast.svelte';

  let { medications }: { medications: Medication[] } = $props();

  let quantities: Record<string, number> = $state({});

  function getQty(medId: string) { return quantities[medId] ?? 1; }
  function setQty(medId: string, val: number) { quantities[medId] = Math.max(1, Math.min(10, val)); }
</script>

<div class="flex flex-wrap gap-2 sm:gap-3">
  {#each medications as med}
    <form
      method="POST"
      action="?/logDose"
      use:enhance={() => {
        return async ({ result, update }) => {
          if (result.type === 'success') {
            const qty = getQty(med.id);
            const label = qty > 1 ? `${med.name} ×${qty} logged` : `${med.name} logged`;
            showToast(label, 'success');
          }
          await update();
        };
      }}
    >
      <input type="hidden" name="medicationId" value={med.id} />
      <input type="hidden" name="quantity" value={getQty(med.id)} />

      <div
        class="flex items-center rounded-full text-sm font-medium text-white overflow-hidden"
        style="background-color: {med.colour}"
      >
        <!-- Minus button (only visible when qty > 1) -->
        {#if getQty(med.id) > 1}
          <button
            type="button"
            class="px-2 py-2 text-white/70 hover:text-white hover:bg-black/10 transition-colors leading-none select-none"
            aria-label="Decrease quantity"
            onclick={() => setQty(med.id, getQty(med.id) - 1)}
          >−</button>

          <!-- Quantity display -->
          <span class="px-1 tabular-nums text-white/90">{getQty(med.id)}×</span>
        {/if}

        <!-- Submit button: medication name + dosage -->
        <button
          type="submit"
          class="flex items-center gap-2 px-4 py-2 transition-all hover:bg-black/10 active:scale-95"
        >
          <span>{med.name}</span>
          <span class="opacity-70">{med.dosageAmount}{med.dosageUnit}</span>
        </button>

        <!-- Plus button -->
        <button
          type="button"
          class="px-2 py-2 text-white/70 hover:text-white hover:bg-black/10 transition-colors leading-none select-none"
          aria-label="Increase quantity"
          onclick={() => setQty(med.id, getQty(med.id) + 1)}
        >+</button>
      </div>
    </form>
  {/each}
</div>
