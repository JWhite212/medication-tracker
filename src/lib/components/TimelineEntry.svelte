<script lang="ts">
  import { enhance } from '$app/forms';
  import TimeSince from '$components/TimeSince.svelte';
  import { formatTime } from '$lib/utils/time';
  import { showToast } from '$components/ui/Toast.svelte';
  import type { DoseLogWithMedication } from '$lib/types';

  let { dose, timezone }: { dose: DoseLogWithMedication; timezone: string } = $props();
  let showActions = $state(false);
</script>

<div
  class="flex items-center gap-4 rounded-lg border border-glass-border bg-glass p-4 backdrop-blur-xl transition-colors hover:bg-glass-hover"
  role="listitem"
  onmouseenter={() => (showActions = true)}
  onmouseleave={() => (showActions = false)}
>
  <div class="h-3 w-3 shrink-0 rounded-full" style="background-color: {dose.medication.colour}"></div>

  <div class="min-w-0 flex-1">
    <p class="font-medium">
      {dose.medication.name}
      <span class="text-sm text-text-secondary">
        {dose.medication.dosageAmount}{dose.medication.dosageUnit}
        {#if dose.quantity > 1}&times; {dose.quantity}{/if}
      </span>
    </p>
  </div>

  <div class="flex items-center gap-4 text-sm">
    <span class="text-text-secondary">{formatTime(new Date(dose.takenAt), timezone)}</span>
    <span class="font-medium text-accent">
      <TimeSince date={new Date(dose.takenAt)} />
    </span>
  </div>

  {#if showActions}
    <form method="POST" action="?/deleteDose" use:enhance={() => {
      return async ({ result, update }) => {
        if (result.type === 'success') showToast('Dose removed', 'success');
        await update();
      };
    }}>
      <input type="hidden" name="doseId" value={dose.id} />
      <button type="submit" class="text-xs text-text-muted hover:text-danger" aria-label="Delete dose">
        &times;
      </button>
    </form>
  {/if}
</div>
