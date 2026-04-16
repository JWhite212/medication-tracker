<script lang="ts">
  import { enhance } from '$app/forms';
  import { showToast } from '$components/ui/Toast.svelte';
  import SideEffectPicker from '$components/SideEffectPicker.svelte';
  import type { DoseLogWithMedication, SideEffect } from '$lib/types';

  let { dose, onclose }: { dose: DoseLogWithMedication; onclose: () => void } = $props();
  let loading = $state(false);
  let sideEffects = $state<SideEffect[]>(dose.sideEffects ?? []);

  // Format date for datetime-local input (YYYY-MM-DDTHH:mm)
  function toDateTimeLocal(date: Date): string {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }
</script>

<form
  method="POST"
  action="?/editDose"
  use:enhance={() => {
    loading = true;
    return async ({ result, update }) => {
      loading = false;
      if (result.type === 'success') {
        showToast('Dose updated', 'success');
        onclose();
      }
      await update();
    };
  }}
  class="space-y-4"
>
  <input type="hidden" name="doseId" value={dose.id} />

  <div class="flex items-center gap-3 mb-2">
    <div class="h-4 w-4 rounded-full" style="background-color: {dose.medication.colour}"></div>
    <h3 class="text-lg font-semibold">{dose.medication.name}</h3>
    <span class="text-sm text-text-secondary">{dose.medication.dosageAmount}{dose.medication.dosageUnit}</span>
  </div>

  <div>
    <label for="takenAt" class="mb-1 block text-sm font-medium">Time Taken</label>
    <input
      id="takenAt"
      name="takenAt"
      type="datetime-local"
      value={toDateTimeLocal(new Date(dose.takenAt))}
      class="w-full rounded-lg border border-glass-border bg-surface px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    />
  </div>

  <div>
    <label for="quantity" class="mb-1 block text-sm font-medium">Quantity</label>
    <input
      id="quantity"
      name="quantity"
      type="number"
      min="1"
      max="10"
      value={dose.quantity}
      class="w-full rounded-lg border border-glass-border bg-surface px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
    />
  </div>

  <div>
    <label for="notes" class="mb-1 block text-sm font-medium">Notes</label>
    <textarea
      id="notes"
      name="notes"
      rows="2"
      class="w-full rounded-lg border border-glass-border bg-surface px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      placeholder="Optional notes..."
    >{dose.notes ?? ''}</textarea>
  </div>

  <SideEffectPicker value={sideEffects} onchange={(effects) => (sideEffects = effects)} />
  <input type="hidden" name="sideEffects" value={sideEffects.length > 0 ? JSON.stringify(sideEffects) : ''} />

  <div class="flex gap-3">
    <button
      type="button"
      onclick={onclose}
      class="flex-1 rounded-lg border border-glass-border py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={loading}
      class="flex-1 rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover disabled:opacity-50"
    >
      {loading ? 'Saving...' : 'Save Changes'}
    </button>
  </div>
</form>
