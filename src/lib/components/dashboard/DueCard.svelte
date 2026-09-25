<script lang="ts">
  import { page } from "$app/state";
  import type { DueCard as DueCardData, DueRow } from "$lib/types";
  import type { TimeFormat } from "$lib/utils/time";
  import {
    formatDoseLabel,
    formatSlotTime,
    rowStatusLine,
    toastForSkip,
    toastForTookItAt,
  } from "$lib/utils/dashboard-copy";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";
  import { getDashboardClock } from "./dashboard-clock";
  import { logToastFromReload } from "./dose-toasts";
  import { focusTargetAfterResolve } from "./focus-after";
  import type { StatusMarkerState } from "./status-marker";

  let {
    card,
    serverNow,
    todayStart,
    timezone,
    timeFormat,
    focusAfter,
  }: {
    /** Rows arrive ordered by the composition: top row first, the rest latest first. */
    card: DueCardData;
    serverNow: Date;
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    /** Focus target when neither this card nor any card rendered after it survives the reload. The page passes its h1. */
    focusAfter: () => HTMLElement | null;
  } = $props();

  const clock = getDashboardClock();

  const top = $derived(card.rows[0]);
  const rest = $derived(card.rows.slice(1));
  const doseLabel = $derived(formatDoseLabel(card.name, card.dosageAmount, card.dosageUnit));
  const nameId = $derived(`due-name-${card.key}`);
  const border = $derived(top.state === "due-now" ? "border-accent-ink/50" : "border-warning/50");

  function markerFor(row: DueRow): StatusMarkerState {
    return row.state === "due-now" ? "due-now" : "overdue";
  }

  /**
   * Everything one row's buttons need, resolved to plain values NOW. The toast
   * builders run after the reload, when this card has often unmounted because
   * its row resolved — so they close over values, never over props.
   */
  function rowView(row: DueRow) {
    const slot = new Date(row.expectedTime);
    const label = doseLabel;
    const dayStart = todayStart;
    const tz = timezone;
    const tf = timeFormat;
    const tookToast = toastForTookItAt({
      label,
      at: slot,
      todayStart: dayStart,
      tz,
      timeFormat: tf,
    });
    const skipToast = toastForSkip({ label, slot, todayStart: dayStart, tz, timeFormat: tf });
    return {
      time: formatSlotTime(slot, dayStart, tz, tf),
      status: rowStatusLine({ state: row.state, expectedTime: slot }, serverNow, dayStart, tz, tf),
      tookToast: () => tookToast,
      skipToast: () => skipToast,
      logNowToast: (doseId: string | null) =>
        logToastFromReload(
          page.data,
          doseId,
          { label, quantity: 1, takenAt: clock.serverNow(), todayStart: dayStart },
          tz,
          tf,
        ),
    };
  }
  type RowView = ReturnType<typeof rowView>;

  const topView = $derived(rowView(top));

  // Which cards were rendered after this one at the moment of the tap. After
  // the reload this card may be gone, and the DOM can no longer say.
  let focusSnapshot: {
    key: string;
    following: string[];
    fallback: () => HTMLElement | null;
  } | null = null;

  function snapshotFocusOrder(event: Event & { currentTarget: EventTarget & HTMLElement }) {
    const cards = [...document.querySelectorAll<HTMLElement>("[data-card-key]")];
    const at = cards.indexOf(event.currentTarget);
    focusSnapshot = {
      key: card.key,
      following: cards.slice(at + 1).map((el) => el.dataset.cardKey ?? ""),
      fallback: focusAfter,
    };
  }

  /** The same card if it survived, else the next card, else the page's fallback (its h1). */
  function focusAfterResolve(): HTMLElement | null {
    const snap = focusSnapshot;
    if (!snap) return focusAfter();
    return focusTargetAfterResolve(snap.key, snap.following) ?? snap.fallback();
  }
</script>

{#snippet actions(row: DueRow, view: RowView)}
  {#if row.logNow}
    <DoseActionForm
      class="col-start-3 row-span-2 row-start-1"
      action="?/logDose"
      fields={{ medicationId: card.medicationId, quantity: "1", forSlot: row.expectedTime }}
      label="Log now"
      srContext={`: ${doseLabel}, ${view.time} dose`}
      pendingLabel="Logging…"
      variant="primary"
      buildToast={view.logNowToast}
      undoable
      focusAfter={focusAfterResolve}
    />
  {/if}
  {#if row.tookItAt !== null || row.skipAt !== null}
    <div class="col-start-2 mt-2 flex flex-wrap gap-2">
      {#if row.tookItAt !== null}
        <DoseActionForm
          action="?/logDose"
          fields={{ medicationId: card.medicationId, quantity: "1", takenAt: row.tookItAt }}
          label={`Took it at ${view.time}`}
          srContext={`: ${doseLabel}`}
          pendingLabel="Recording…"
          variant="secondary"
          buildToast={view.tookToast}
          undoable
          focusAfter={focusAfterResolve}
        />
      {/if}
      {#if row.skipAt !== null}
        <DoseActionForm
          action="?/skipDose"
          fields={{ medicationId: card.medicationId, takenAt: row.skipAt }}
          label="Skip"
          srContext={`: ${doseLabel}, ${view.time} dose`}
          pendingLabel="Skipping…"
          variant="quiet"
          buildToast={view.skipToast}
          undoable
          focusAfter={focusAfterResolve}
        />
      {/if}
    </div>
  {/if}
{/snippet}

<!-- Grid, not flex: Log now sits in its own right-hand column spanning both
     rows, and Took it at / Skip sit UNDER the text column — a thumb slipping
     off Log now cannot land on Skip. DOM order puts Log now first in tab order. -->
<li
  tabindex="-1"
  aria-labelledby={nameId}
  data-dose-card
  data-card-key={card.key}
  class="bg-glass rounded-xl border p-3 backdrop-blur-xl {border}"
  onsubmitcapture={snapshotFocusOrder}
>
  <div class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
    <div class="row-span-2 flex flex-col items-center gap-2 pt-1">
      <MedicationGlyph
        colour={card.colour}
        colourSecondary={card.colourSecondary}
        pattern={card.pattern}
        size="md"
      />
      <StatusMarker state={markerFor(top)} />
    </div>
    <div class="min-w-0">
      <p id={nameId} class="flex min-w-0 items-baseline gap-2">
        <span class="text-text-primary text-base font-semibold">{card.name}</span>
        <span class="text-text-secondary truncate text-sm"
          >{card.dosageAmount}{card.dosageUnit}</span
        >
      </p>
      <p class="text-text-primary text-sm">{topView.status}</p>
    </div>
    {@render actions(top, topView)}
  </div>

  {#if rest.length > 0}
    <ul role="list" class="border-glass-border mt-3 space-y-3 border-t pt-3">
      {#each rest as row (row.key)}
        {@const view = rowView(row)}
        <li class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
          <div class="row-span-2 flex justify-center pt-0.5">
            <StatusMarker state={markerFor(row)} />
          </div>
          <p class="text-text-primary min-w-0 text-sm">{view.status}</p>
          {@render actions(row, view)}
        </li>
      {/each}
    </ul>
  {/if}
</li>
