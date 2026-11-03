<script lang="ts">
  import { untrack } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import OnboardingWelcome from "$components/OnboardingWelcome.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import DoseEditForm from "$components/DoseEditForm.svelte";
  import KeyboardShortcuts from "$components/KeyboardShortcuts.svelte";
  import RefillsCard, { refillChip } from "$components/RefillsCard.svelte";
  import Button from "$components/ui/Button.svelte";
  import QuickLogBar from "$components/QuickLogBar.svelte";
  import DashboardHeader from "$components/dashboard/DashboardHeader.svelte";
  import DueCard from "$components/dashboard/DueCard.svelte";
  import DoneList, { restoredDoneRowFocus } from "$components/dashboard/DoneList.svelte";
  import LaterList from "$components/dashboard/LaterList.svelte";
  import DoseActionForm from "$components/dashboard/DoseActionForm.svelte";
  import { createDashboardClock, setDashboardClock } from "$components/dashboard/dashboard-clock";
  import { DONE_HEADING_ID } from "$components/dashboard/dom-ids";
  import { pageHeading } from "$components/dose-writes/focus-after";
  import { formatDoseLabel, toastForDoseRemoved } from "$lib/utils/dashboard-copy";
  import { formatUserTime, type DateFormat, type TimeFormat } from "$lib/utils/time";
  import type { DoseLogWithMedication, RefillForecastEntry } from "$lib/types";
  import {
    normaliseOption,
    resolveDashboardLayout,
    SECTION_LABELS,
    type DashboardSectionId,
  } from "$lib/dashboard/layout";
  import { DASHBOARD_LATER_MODES, DONE_TIME_DISPLAYS } from "$lib/preferences/domains";

  let { data } = $props();

  let editingDose = $state<DoseLogWithMedication | null>(null);

  const timeFormat = $derived(data.preferences.timeFormat as TimeFormat);
  const timeSinceDaysFromHours = $derived(data.preferences.timeSinceDaysFromHours);
  const dateFormat = $derived(data.preferences.dateFormat as DateFormat);
  const todayStart = $derived(new Date(data.todayStart));
  const asNeededOnly = $derived(data.status.kind === "as-needed-only");
  const doneTitle = $derived(asNeededOnly ? "Logged today" : "Done today");
  const hasDue = $derived(data.earlier.length + data.today.length > 0);

  /**
   * "Urgent" for the hidden-Refills floor: every row the card draws as
   * needing you, by the card's own rule. One predicate decides both whether
   * the floor applies and which rows it keeps.
   */
  const needsYou = (entry: RefillForecastEntry) => refillChip(entry)?.tone === "needs-you";

  // The stored layout values, gathered once. The resolver reads the order and
  // the three flags; the section snippet reads the two options. The options
  // are read tolerantly, so a value a newer build wrote cannot break the page.
  const stored = $derived({
    order: data.preferences.dashboardSectionOrder,
    showLater: data.preferences.dashboardShowLater,
    showQuickLog: data.preferences.dashboardShowQuickLog,
    showRefills: data.preferences.dashboardShowRefills,
    laterMode: normaliseOption(data.preferences.dashboardLaterMode, DASHBOARD_LATER_MODES, "next"),
    doneTime: normaliseOption(data.preferences.dashboardDoneTime, DONE_TIME_DISPLAYS, "both"),
  });

  // Order and visibility only. What each section holds is the composer's.
  const layout = $derived(
    resolveDashboardLayout({
      order: stored.order,
      showLater: stored.showLater,
      showQuickLog: stored.showQuickLog,
      showRefills: stored.showRefills,
      variant: asNeededOnly ? "as-needed-only" : "scheduled",
      hasUrgentRefill: data.refillForecast.some(needsYou),
    }),
  );
  const refillEntries = $derived(
    layout.refillsUrgentOnly ? data.refillForecast.filter(needsYou) : data.refillForecast,
  );
  const URGENT_REFILLS_NOTE = "Showing urgent refills only. Refills is hidden on your dashboard.";
  const quickLogShown = $derived(
    layout.pinned === "quickLog" || layout.sections.includes("quickLog"),
  );

  /** "Customise this page", or which sections a preference hides. */
  function footerLine(hidden: readonly DashboardSectionId[]): string {
    if (hidden.length === 0) return "Customise this page";
    const names = hidden.map((id) => SECTION_LABELS[id]);
    const list =
      names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    return `${list} ${hidden.length === 1 ? "is" : "are"} hidden · Customise`;
  }

  // One server-relative clock. Every DoseActionForm, DueCard and chip reads
  // it from context; nothing here re-implements a timer or a skew. The write
  // lock they also read is the (app) layout's, shared with every page.
  //
  // Seeded from the payload this page rendered with, so the stale guard can
  // answer from the first tap rather than reading NaN until the effect below
  // runs. The seed arms no timer: during SSR a setTimeout would outlive the
  // request. `untrack` because the seed is deliberately the FIRST payload
  // only; the effect adopts every later one through sync().
  const clock = createDashboardClock(
    invalidateAll,
    untrack(() => ({ now: data.now, nextRefreshAt: data.nextRefreshAt })),
  );
  setDashboardClock(clock);

  // The instant visible durations are rendered against. It starts at the
  // server's own `now`, so SSR and hydration print the same text, then
  // follows clock.serverNow() every 60s (the TimeSince pattern).
  let tickMs = $state<number | null>(null);
  const renderNow = $derived(new Date(tickMs ?? Date.parse(data.now)));

  // Once per payload: re-measure the skew and re-arm the one refresh timer
  // at nextRefreshAt. The teardown clears it before the next payload's sync,
  // and on unmount.
  $effect(() => {
    clock.sync({ now: data.now, nextRefreshAt: data.nextRefreshAt });
    tickMs = clock.serverNow().getTime();
    return () => clock.dispose();
  });

  $effect(() => {
    const tick = () => {
      tickMs = clock.serverNow().getTime();
    };
    const interval = setInterval(tick, 60_000);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      tick();
      clock.onVisible();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // A refresh that came due offline waits for the connection to return.
    window.addEventListener("online", clock.onOnline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", clock.onOnline);
    };
  });

  /**
   * The Done h2 (tabindex="-1", always rendered): focus after Remove, and
   * where the edit dialog returns focus when the Edit that opened it has gone
   * (a refused Remove's reload dropped its row).
   */
  const doneHeading = () => document.getElementById(DONE_HEADING_ID);

  /**
   * The edit dialog's Remove toast: "Dose removed: Metformin 500mg at 08:00",
   * or "… yesterday at 22:00" for a dose Done carried over from before
   * today's midnight — the same test the server applies to the row's Edit
   * label (`takenAt < todayStart`). Resolved to a string when the dialog
   * renders, because it is read after the reload and onSuccess clears
   * editingDose straight after.
   */
  function removedToast(dose: DoseLogWithMedication): () => string {
    const med = dose.medication;
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const takenAt = new Date(dose.takenAt);
    const at = formatUserTime(takenAt, data.timezone, timeFormat);
    const day = takenAt.getTime() < todayStart.getTime() ? "yesterday" : "today";
    const message = toastForDoseRemoved(label, at, day);
    return () => message;
  }
</script>

<svelte:head>
  <title>Dashboard — MedTracker</title>
</svelte:head>

{#snippet chips(title: string)}
  <section aria-labelledby="quick-log-heading">
    <h2
      id="quick-log-heading"
      class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
    >
      {title}
    </h2>
    <QuickLogBar
      medications={data.medications}
      {todayStart}
      timezone={data.timezone}
      {timeFormat}
    />
  </section>
{/snippet}

<!-- One section of the account's order, with today's exact markup and props.
     A hidden section is not rendered at all, so no id is ever duplicated. -->
{#snippet section(id: DashboardSectionId)}
  {#if id === "done"}
    <DoneList
      rows={data.done}
      title={doneTitle}
      serverNow={renderNow}
      {todayStart}
      timezone={data.timezone}
      {timeFormat}
      {timeSinceDaysFromHours}
      timeDisplay={stored.doneTime}
      onedit={(dose) => (editingDose = dose)}
    />
  {:else if id === "later"}
    <LaterList
      rows={data.later}
      mode={stored.laterMode}
      serverNow={renderNow}
      {todayStart}
      timezone={data.timezone}
      {timeFormat}
    />
  {:else if id === "quickLog"}
    {@render chips("Log something else")}
  {:else if id === "refills"}
    <RefillsCard
      entries={refillEntries}
      note={layout.refillsUrgentOnly ? URGENT_REFILLS_NOTE : undefined}
    />
  {/if}
{/snippet}

{#if data.medications.length === 0}
  <OnboardingWelcome />
{:else}
  <div class="mx-auto w-full max-w-2xl space-y-6">
    <DashboardHeader
      status={data.status}
      serverNow={renderNow}
      timezone={data.timezone}
      {timeFormat}
      {dateFormat}
    />

    <!-- The pinned block sits outside the account's order, so "Due first"
         holds by construction rather than by a sort. -->
    {#if layout.pinned === "quickLog"}
      <!-- No active medication has an interval or fixed-time schedule, so
           nothing can be due: the chips are the page. -->
      {@render chips("Log a dose")}
    {:else if hasDue}
      <section aria-labelledby="due-heading" class="space-y-3">
        <h2 id="due-heading" class="sr-only">Due</h2>
        {#if data.earlier.length > 0}
          <h3 class="text-text-secondary text-sm font-semibold">Earlier</h3>
          <ul role="list" data-due-list="earlier" class="space-y-3">
            {#each data.earlier as card (card.key)}
              <DueCard
                {card}
                serverNow={renderNow}
                {todayStart}
                timezone={data.timezone}
                {timeFormat}
                focusAfter={pageHeading}
              />
            {/each}
          </ul>
        {/if}
        {#if data.today.length > 0}
          {#if data.earlier.length > 0}
            <h3 class="text-text-secondary text-sm font-semibold">Today</h3>
          {/if}
          <ul role="list" data-due-list="today" class="space-y-3">
            {#each data.today as card (card.key)}
              <DueCard
                {card}
                serverNow={renderNow}
                {todayStart}
                timezone={data.timezone}
                {timeFormat}
                focusAfter={pageHeading}
              />
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#each layout.sections as id (id)}
      {@render section(id)}
    {/each}

    <div>
      <Button variant="ghost" size="sm" href="/settings/dashboard?from=dashboard">
        {footerLine(layout.hidden)}
      </Button>
    </div>
  </div>
{/if}

<!-- returnFocus: a Remove refused because another device had already removed
     the dose leaves the dialog open, and its reload drops the Done row whose
     Edit opened it. Closing it then returns focus to the Done heading, the
     same place a successful Remove sends it. -->
<Modal
  open={editingDose !== null}
  onclose={() => (editingDose = null)}
  title={editingDose ? `Edit dose of ${editingDose.medication.name}` : "Edit dose"}
  returnFocus={doneHeading}
>
  {#if editingDose}
    <!-- Edit keeps DoseEditForm's own enhance for its inline field errors
         (the component is shared with /log), but its Save starts through
         beginDoseWrite under the (app) layout's write lock. Remove is a
         separate DoseActionForm on that same lock, so Save and Remove
         exclude each other. -->
    <DoseEditForm
      dose={editingDose}
      timezone={data.timezone}
      onclose={() => (editingDose = null)}
    />
    <div class="border-glass-border mt-4 border-t pt-4">
      <DoseActionForm
        action="?/deleteDose"
        fields={{ doseId: editingDose.id }}
        label="Remove this dose"
        pendingLabel="Removing…"
        variant="danger"
        buildToast={removedToast(editingDose)}
        undo={{ kind: "restore", focusTarget: restoredDoneRowFocus(editingDose.id) }}
        withdrawsUndoFor={editingDose.id}
        focusAfter={doneHeading}
        onSuccess={() => (editingDose = null)}
      />
    </div>
  {/if}
</Modal>

<KeyboardShortcuts medications={data.medications} quickLog={quickLogShown} />
