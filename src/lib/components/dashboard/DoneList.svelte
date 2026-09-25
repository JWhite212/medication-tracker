<script lang="ts">
  import type { DoneRow, DoseLogWithMedication } from "$lib/types";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { formatDoseLabel, formatSlotTime } from "$lib/utils/dashboard-copy";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";
  import { DONE_HEADING_ID } from "./dom-ids";

  let {
    rows,
    title,
    todayStart,
    timezone,
    timeFormat,
    onedit,
  }: {
    rows: DoneRow[];
    /** "Done today", or "Logged today" on an as-needed-only account. */
    title: string;
    /** Covered slots before this instant are prefixed "yesterday". */
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    onedit: (dose: DoseLogWithMedication) => void;
  } = $props();

  function focusDoneHeading(): HTMLElement | null {
    return document.getElementById(DONE_HEADING_ID);
  }

  function view(row: DoneRow) {
    const { dose } = row;
    const med = dose.medication;
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const time = formatUserTime(new Date(dose.takenAt), timezone, timeFormat);
    const when = row.dayLabel === "yesterday" ? `yesterday ${time}` : time;
    const covers = row.covers.map((iso) =>
      formatSlotTime(new Date(iso), todayStart, timezone, timeFormat),
    );
    const removeToast =
      dose.status === "skipped" ? `${label}: skip undone` : `${label}: missed entry removed`;
    return {
      label,
      time,
      when,
      dose: `${med.dosageAmount}${med.dosageUnit}${
        dose.status === "taken" && dose.quantity > 1 ? ` ×${dose.quantity}` : ""
      }`,
      statusWord:
        dose.status === "skipped" ? "Skipped" : dose.status === "missed" ? "Missed" : null,
      // Facts only, no verdict: the slots this dose resolved.
      coversText: covers.length > 0 ? `for ${covers.join(", ")}` : null,
      removeLabel: dose.status === "skipped" ? "Undo skip" : "Remove",
      removeToast: () => removeToast,
    };
  }
</script>

<section aria-labelledby={DONE_HEADING_ID}>
  <!-- tabindex="-1" and always rendered: focus lands here after Remove or Undo skip. -->
  <h2
    id={DONE_HEADING_ID}
    tabindex="-1"
    class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
  >
    {title}
  </h2>
  <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
    {#if rows.length === 0}
      <p class="text-text-secondary py-3 text-sm">Nothing logged yet today</p>
    {:else}
      <ul role="list" class="divide-glass-border divide-y">
        {#each rows as row (row.key)}
          {@const v = view(row)}
          <li class="flex min-h-11 items-center gap-3 py-1">
            <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
              {#if row.dayLabel === "yesterday"}<span class="block text-xs">Yesterday</span
                >{/if}{v.time}
            </span>
            <StatusMarker state={row.dose.status} />
            <MedicationGlyph
              colour={row.dose.medication.colour}
              colourSecondary={row.dose.medication.colourSecondary}
              pattern={row.dose.medication.pattern}
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <p class="flex min-w-0 items-baseline gap-2 text-sm">
                <span class="text-text-primary truncate font-medium"
                  >{row.dose.medication.name}</span
                >
                <span class="text-text-secondary shrink-0">{v.dose}</span>
                {#if v.statusWord}
                  <span class="text-text-secondary shrink-0">{v.statusWord}</span>
                {/if}
              </p>
              {#if v.coversText}
                <p class="text-text-secondary truncate text-xs">{v.coversText}</p>
              {/if}
            </div>
            {#if row.dose.status === "taken"}
              <button
                type="button"
                class="border-border-strong text-text-primary hover:bg-surface-overlay h-11 shrink-0 rounded-lg border px-3 text-sm font-medium"
                onclick={() => onedit(row.dose)}
                >Edit<span class="sr-only">: {v.label} dose taken at {v.when}</span></button
              >
            {:else}
              <DoseActionForm
                class="shrink-0"
                action="?/deleteDose"
                fields={{ doseId: row.dose.id }}
                label={v.removeLabel}
                srContext={`: ${v.label}, ${row.dose.status} at ${v.when}`}
                pendingLabel="Removing…"
                variant="quiet"
                buildToast={v.removeToast}
                focusAfter={focusDoneHeading}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
