<script lang="ts">
  import { enhance } from "$app/forms";
  import type { Medication, MedicationTimingStatus } from "$lib/types";
  import { showToast } from "$components/ui/Toast.svelte";
  import { getMedicationBackground, getReadableTextColor } from "$lib/utils/medication-style";
  import { formatDueIn } from "$lib/utils/time";

  let {
    medications,
    timingStatus = [],
  }: { medications: Medication[]; timingStatus?: MedicationTimingStatus[] } = $props();

  let quantities: Record<string, number> = $state({});
  let flashingMeds: Record<string, boolean> = $state({});

  function getQty(medId: string) {
    return quantities[medId] ?? 1;
  }
  function setQty(medId: string, val: number) {
    quantities[medId] = Math.max(1, Math.min(10, val));
  }
  function triggerFlash(medId: string) {
    flashingMeds[medId] = true;
    setTimeout(() => {
      flashingMeds[medId] = false;
    }, 700);
  }

  const timingMap = $derived(new Map(timingStatus.map((t) => [t.medicationId, t])));
</script>

<div class="flex flex-wrap gap-2 sm:gap-3">
  {#each medications as med}
    {@const timing = timingMap.get(med.id)}
    {@const fg = getReadableTextColor(med.colour, med.colourSecondary)}
    <form
      method="POST"
      action="?/logDose"
      use:enhance={() => {
        return async ({ result, update }) => {
          if (result.type === "success") {
            const qty = getQty(med.id);
            const label = qty > 1 ? `${med.name} ×${qty} logged` : `${med.name} logged`;
            showToast(label, "success");
            triggerFlash(med.id);
          }
          await update();
        };
      }}
    >
      <input type="hidden" name="medicationId" value={med.id} />
      <input type="hidden" name="quantity" value={getQty(med.id)} />

      <div class="flex flex-col items-center gap-1">
        <div
          class="flex items-center overflow-hidden rounded-full text-sm font-medium {flashingMeds[
            med.id
          ]
            ? 'animate-success-flash'
            : ''}"
          style="background: {getMedicationBackground(
            med.colour,
            med.colourSecondary,
            med.pattern,
          )}; color: {fg.color}; text-shadow: {fg.textShadow};"
        >
          <!-- Minus button (only visible when qty > 1) -->
          {#if getQty(med.id) > 1}
            <button
              type="button"
              class="px-2 py-2 leading-none opacity-70 transition-[opacity,background-color] select-none hover:bg-black/10 hover:opacity-100"
              aria-label="Decrease quantity"
              onclick={() => setQty(med.id, getQty(med.id) - 1)}>−</button
            >

            <!-- Quantity display -->
            <span class="px-1 tabular-nums opacity-90">{getQty(med.id)}×</span>
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
            class="px-2 py-2 leading-none opacity-70 transition-[opacity,background-color] select-none hover:bg-black/10 hover:opacity-100"
            aria-label="Increase quantity"
            onclick={() => setQty(med.id, getQty(med.id) + 1)}>+</button
          >
        </div>

        {#if timing && timing.status !== "ok"}
          <span
            class="text-xs font-medium {timing.status === 'overdue'
              ? 'text-warning'
              : timing.status === 'due_now'
                ? 'text-accent animate-pulse'
                : 'text-text-muted'}"
          >
            {formatDueIn(timing.minutesUntilDue * 60_000)}
          </span>
        {/if}
      </div>
    </form>
  {/each}
</div>
