<script lang="ts">
  import { enhance } from '$app/forms';
  import type { Medication } from '$lib/types';
  import { showToast } from '$components/ui/Toast.svelte';

  let { medications }: { medications: Medication[] } = $props();
</script>

<div class="flex flex-wrap gap-2">
  {#each medications as med}
    <form
      method="POST"
      action="?/logDose"
      use:enhance={() => {
        return async ({ result, update }) => {
          if (result.type === 'success') {
            showToast(`${med.name} logged`, 'success');
          }
          await update();
        };
      }}
    >
      <input type="hidden" name="medicationId" value={med.id} />
      <button
        type="submit"
        class="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white transition-all hover:scale-105 active:scale-95"
        style="background-color: {med.colour}"
      >
        <span>+</span>
        <span>{med.name}</span>
        <span class="opacity-70">{med.dosageAmount}{med.dosageUnit}</span>
      </button>
    </form>
  {/each}
</div>
