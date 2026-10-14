<script lang="ts" module>
  import { focusTargetAfterResolve } from "$components/dose-writes/focus-after";
  import { DONE_HEADING_ID } from "./dom-ids";

  /**
   * Where focus goes once an Undo has restored a Done row: that row's Edit,
   * else the Done heading. A restored skip or missed entry has no Edit — its
   * only control is Remove, a write — so it gets the heading rather than a
   * button that would remove it again. Called after the restore's reload, so
   * the row is looked up by its `data-dose-id`, never held as an element.
   * Exported for the dashboard's edit-dialog Remove, which restores into this
   * list too.
   */
  export function restoredDoneRowFocus(doseId: string): () => HTMLElement | null {
    return () =>
      focusTargetAfterResolve(doseId, [], {
        attr: "doseId",
        pick: (row) => row.querySelector<HTMLElement>("[data-edit]"),
      }) ?? document.getElementById(DONE_HEADING_ID);
  }
</script>

<script lang="ts">
  import type { DoneRow, DoseLogWithMedication } from "$lib/types";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { doneCoversLine, doneDoseText, formatDoseLabel } from "$lib/utils/dashboard-copy";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";

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
    const skipped = dose.status === "skipped";
    const removeToast = skipped ? `${label}: skip removed` : `${label}: missed entry removed`;
    return {
      label,
      time,
      when,
      dose: doneDoseText({
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        quantity: dose.quantity,
        status: dose.status,
      }),
      statusWord:
        dose.status === "skipped" ? "Skipped" : dose.status === "missed" ? "Missed" : null,
      // Facts only, no verdict: the slots this dose resolved.
      coversText: doneCoversLine(row.covers, todayStart, timezone, timeFormat),
      // "Remove skip", not "Undo skip": every Undo offer now has a button
      // named Undo, and "click Undo" must not be ambiguous for voice control.
      removeLabel: skipped ? "Remove skip" : "Remove",
      removeToast: () => removeToast,
      restoreFocus: restoredDoneRowFocus(dose.id),
    };
  }
</script>

<section aria-labelledby={DONE_HEADING_ID}>
  <!-- tabindex="-1" and always rendered: focus lands here after Remove or
       Remove skip, and after an Undo restores a row that has no Edit. -->
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
          <!-- data-dose-id and data-edit are how an Undo finds the restored
               row after the reload has re-rendered it. -->
          <li data-dose-id={row.dose.id} class="flex min-h-11 items-center gap-3 py-1">
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
                data-edit
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
                undo={{ kind: "restore", focusTarget: v.restoreFocus }}
                withdrawsUndoFor={row.dose.id}
                focusAfter={focusDoneHeading}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
