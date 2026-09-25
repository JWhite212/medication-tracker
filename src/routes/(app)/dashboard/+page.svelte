<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import OnboardingWelcome from "$components/OnboardingWelcome.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import DoseEditForm from "$components/DoseEditForm.svelte";
  import KeyboardShortcuts from "$components/KeyboardShortcuts.svelte";
  import RefillsCard from "$components/RefillsCard.svelte";
  import QuickLogBar from "$components/QuickLogBar.svelte";
  import DashboardHeader from "$components/dashboard/DashboardHeader.svelte";
  import DueCard from "$components/dashboard/DueCard.svelte";
  import DoneList from "$components/dashboard/DoneList.svelte";
  import LaterList from "$components/dashboard/LaterList.svelte";
  import DoseActionForm from "$components/dashboard/DoseActionForm.svelte";
  import {
    createDoseWriteLock,
    setDoseWriteLock,
  } from "$components/dashboard/dose-write-lock.svelte";
  import { createDashboardClock, setDashboardClock } from "$components/dashboard/dashboard-clock";
  import { DASHBOARD_HEADING_ID, DONE_HEADING_ID } from "$components/dashboard/dom-ids";
  import type { DateFormat, TimeFormat } from "$lib/utils/time";
  import type { DoseLogWithMedication } from "$lib/types";

  let { data } = $props();

  let editingDose = $state<DoseLogWithMedication | null>(null);

  const timeFormat = $derived(data.preferences.timeFormat as TimeFormat);
  const dateFormat = $derived(data.preferences.dateFormat as DateFormat);
  const todayStart = $derived(new Date(data.todayStart));
  const asNeededOnly = $derived(data.status.kind === "as-needed-only");
  const doneTitle = $derived(asNeededOnly ? "Logged today" : "Done today");
  const hasDue = $derived(data.earlier.length + data.today.length > 0);

  // One page-wide write lock and one server-relative clock. Every
  // DoseActionForm, DueCard and chip reads them from context; nothing here
  // re-implements a timer, a skew or a lock.
  setDoseWriteLock(createDoseWriteLock());
  const clock = createDashboardClock(invalidateAll);
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

  /** DueCard's last resort after a row resolves: the same card, else the next card, else this h1. */
  const headingTarget = () => document.getElementById(DASHBOARD_HEADING_ID);
  /** The Done h2 (tabindex="-1", always rendered): focus after Remove. */
  const doneHeading = () => document.getElementById(DONE_HEADING_ID);
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

    {#if asNeededOnly}
      <!-- No active medication has an interval or fixed-time schedule, so
           nothing can be due: the chips are the page. -->
      {@render chips("Log a dose")}
      <DoneList
        rows={data.done}
        title={doneTitle}
        {todayStart}
        timezone={data.timezone}
        {timeFormat}
        onedit={(dose) => (editingDose = dose)}
      />
    {:else}
      {#if hasDue}
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
                  focusAfter={headingTarget}
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
                  focusAfter={headingTarget}
                />
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <DoneList
        rows={data.done}
        title={doneTitle}
        {todayStart}
        timezone={data.timezone}
        {timeFormat}
        onedit={(dose) => (editingDose = dose)}
      />

      <LaterList
        rows={data.later}
        serverNow={renderNow}
        {todayStart}
        timezone={data.timezone}
        {timeFormat}
      />

      {@render chips("Log something else")}
    {/if}

    <RefillsCard entries={data.refillForecast} />
  </div>
{/if}

<Modal
  open={editingDose !== null}
  onclose={() => (editingDose = null)}
  title={editingDose ? `Edit dose of ${editingDose.medication.name}` : "Edit dose"}
>
  {#if editingDose}
    <!-- Edit stays on DoseEditForm's own enhance: the component is shared
         with /log. Remove is a separate form so it goes through the page's
         write lock like every other dose write. -->
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
        buildToast={() => "Dose removed"}
        focusAfter={doneHeading}
        onSuccess={() => (editingDose = null)}
      />
    </div>
  {/if}
</Modal>

<KeyboardShortcuts medications={data.medications} />
