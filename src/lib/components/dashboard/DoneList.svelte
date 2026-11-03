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
  import type { DoneTimeDisplay } from "$lib/preferences/domains";
  import { formatTimeSince, formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { doneCoversLine, doneDoseText, formatDoseLabel } from "$lib/utils/dashboard-copy";
  import { toneClass, toneOf } from "$lib/utils/status-tone";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";

  let {
    rows,
    title,
    serverNow,
    todayStart,
    timezone,
    timeFormat,
    timeSinceDaysFromHours,
    timeDisplay = "both",
    onedit,
  }: {
    rows: DoneRow[];
    /** "Done today", or "Logged today" on an as-needed-only account. */
    title: string;
    /**
     * The page's server-relative 60-second tick. A taken row's "2h 15m ago"
     * is measured from it, never from the device clock, so it agrees with
     * every other duration on the page.
     */
    serverNow: Date;
    /** Covered slots before this instant are prefixed "yesterday". */
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    /** The account's hours-before-days switch for a taken row's "ago". */
    timeSinceDaysFromHours: number;
    /**
     * What a taken row's time column shows: the clock and how long ago
     * ("both"), only how long ago with the clock in a tooltip and for
     * assistive tech ("since"), or only the clock ("clock"). A skip or
     * missed row's instant is a slot, so it always shows its clock.
     */
    timeDisplay?: DoneTimeDisplay;
    onedit: (dose: DoseLogWithMedication) => void;
  } = $props();

  function focusDoneHeading(): HTMLElement | null {
    return document.getElementById(DONE_HEADING_ID);
  }

  function view(row: DoneRow) {
    const { dose } = row;
    const med = dose.medication;
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const takenAt = new Date(dose.takenAt);
    const time = formatUserTime(takenAt, timezone, timeFormat);
    const when = row.dayLabel === "yesterday" ? `yesterday ${time}` : time;
    const skipped = dose.status === "skipped";
    const removeToast = skipped ? `${label}: skip removed` : `${label}: missed entry removed`;
    return {
      label,
      time,
      when,
      // Taken rows only: the question it answers is "when did I last take
      // this?". A skip or missed row's instant is a slot, not an intake.
      since:
        dose.status === "taken"
          ? formatTimeSince(takenAt, serverNow, timeSinceDaysFromHours)
          : null,
      takenAtIso: takenAt.toISOString(),
      dose: doneDoseText({
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        quantity: dose.quantity,
        status: dose.status,
      }),
      statusWord:
        dose.status === "skipped" ? "Skipped" : dose.status === "missed" ? "Missed" : null,
      statusClass: toneClass(
        toneOf(dose.status === "missed" ? "dose-missed" : "dose-skipped"),
        "text",
      ),
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
  {#if rows.length === 0}
    <!-- One plain line, not an empty card: a card here was the biggest
         thing on the page and said nothing. -->
    <p class="text-text-secondary text-sm">Nothing logged yet today</p>
  {:else}
    <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
      <ul role="list" class="divide-glass-border divide-y">
        {#each rows as row (row.key)}
          {@const v = view(row)}
          <!-- data-dose-id and data-edit are how an Undo finds the restored
               row after the reload has re-rendered it. -->
          <li data-dose-id={row.dose.id} class="flex min-h-11 items-center gap-2 py-1 sm:gap-3">
            <!-- since mode takes min-w-24 from sm up. On a phone the extra 16px
                 came out of the name and dose and ran "×4" under Edit at 320px,
                 so it keeps the 80px every mode had. -->
            <span
              class="text-text-secondary {timeDisplay === 'since'
                ? 'min-w-24 max-sm:min-w-20'
                : 'min-w-20'} shrink-0 text-sm tabular-nums"
            >
              {#if row.dayLabel === "yesterday"}<span class="block text-xs">Yesterday</span
                >{/if}{#if timeDisplay === "since" && v.since}
                <!-- The since text is the line; the clock stays in the tooltip
                     and, for a screen reader, after it. Not a live region:
                     re-announcing every minute would bury everything else a
                     screen reader is saying. -->
                <time
                  datetime={v.takenAtIso}
                  data-time-since
                  title={v.time}
                  class="text-text-primary block text-sm"
                  >{v.since}<span class="sr-only">{` at ${v.time}`}</span></time
                >
              {:else}
                <span class="block">{v.time}</span>
                {#if timeDisplay === "both" && v.since}
                  <time datetime={v.takenAtIso} data-time-since class="block text-xs"
                    >{v.since}</time
                  >
                {/if}
              {/if}
            </span>
            <StatusMarker state={row.dose.status} />
            <MedicationGlyph
              colour={row.dose.medication.colour}
              colourSecondary={row.dose.medication.colourSecondary}
              pattern={row.dose.medication.pattern}
              size="sm"
            />
            <!-- On a phone the name has a line to itself and the dose and status
                 word go under it: on one line beside a worded button, the
                 name was squeezed to nothing and the words ran over the
                 button. From sm up there is room for one line. -->
            <div class="min-w-0 flex-1">
              <p class="flex min-w-0 flex-col text-sm sm:flex-row sm:items-baseline sm:gap-2">
                <span class="text-text-primary truncate font-medium"
                  >{row.dose.medication.name}</span
                >
                <span
                  class="flex min-w-0 flex-wrap items-baseline gap-x-2 sm:shrink-0 sm:flex-nowrap"
                >
                  <span class="text-text-secondary shrink-0">{v.dose}</span>
                  {#if v.statusWord}
                    <span class="shrink-0 {v.statusClass}">{v.statusWord}</span>
                  {/if}
                </span>
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
                iconOnlyOnPhone
              >
                <!-- × on a phone, where "Remove skip" plus its pending label
                     took a third of the row. /log's delete is the same ×. -->
                <span aria-hidden="true" class="text-base leading-none sm:hidden">&times;</span>
              </DoseActionForm>
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
