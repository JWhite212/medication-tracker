<script lang="ts">
  import { enhance } from "$app/forms";
  import TimeSince from "$components/TimeSince.svelte";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { showToast } from "$components/ui/Toast.svelte";
  import type { DoseLogWithMedication } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";

  let {
    dose,
    timezone,
    timeFormat = "12h",
    onedit,
  }: {
    dose: DoseLogWithMedication;
    timezone: string;
    timeFormat?: TimeFormat;
    onedit?: (dose: DoseLogWithMedication) => void;
  } = $props();
</script>

<div
  class="group border-glass-border bg-glass hover:bg-glass-hover rounded-lg border p-4 backdrop-blur-xl transition-colors {onedit
    ? 'cursor-pointer'
    : ''}"
  role="listitem"
  onclick={() => onedit?.(dose)}
>
  <div class="flex items-center gap-4">
    <div
      class="h-3 w-3 shrink-0 rounded-full"
      style="background: {getMedicationBackground(
        dose.medication.colour,
        dose.medication.colourSecondary,
        dose.medication.pattern,
        true,
      )}"
    ></div>

    <div class="min-w-0 flex-1">
      <p class="font-medium">
        {dose.medication.name}
        <span class="text-text-secondary text-sm">
          {dose.medication.dosageAmount}{dose.medication.dosageUnit}
          {#if dose.quantity > 1}&times; {dose.quantity}{/if}
        </span>
      </p>
    </div>

    <div class="flex items-center gap-4 text-sm">
      <span class="text-text-secondary"
        >{formatUserTime(new Date(dose.takenAt), timezone, timeFormat)}</span
      >
      <span class="text-accent font-medium">
        <TimeSince date={new Date(dose.takenAt)} />
      </span>
    </div>

    <div
      class="flex items-center gap-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100"
    >
      {#if onedit}
        <button
          type="button"
          onclick={(e) => {
            e.stopPropagation();
            onedit?.(dose);
          }}
          class="text-text-muted hover:text-accent text-xs"
          aria-label="Edit dose"
        >
          ✎
        </button>
      {/if}
      <form
        method="POST"
        action="?/deleteDose"
        use:enhance={() => {
          return async ({ result, update }) => {
            if (result.type === "success") showToast("Dose removed", "success");
            await update();
          };
        }}
      >
        <input type="hidden" name="doseId" value={dose.id} />
        <button
          type="submit"
          onclick={(e) => e.stopPropagation()}
          class="text-text-muted hover:text-danger text-xs"
          aria-label="Delete dose"
        >
          &times;
        </button>
      </form>
    </div>
  </div>

  {#if dose.sideEffects && dose.sideEffects.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5 pl-7">
      {#each dose.sideEffects as effect}
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium {effect.severity === 'severe'
            ? 'bg-danger/15 text-danger'
            : effect.severity === 'moderate'
              ? 'bg-warning/15 text-warning'
              : 'bg-text-secondary/15 text-text-secondary'}"
        >
          {effect.name}
        </span>
      {/each}
    </div>
  {/if}
</div>
