<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { goto, invalidateAll } from "$app/navigation";
  import OnboardingWelcome from "$components/OnboardingWelcome.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import DoseEditForm from "$components/DoseEditForm.svelte";
  import KeyboardShortcuts from "$components/KeyboardShortcuts.svelte";
  import RefillsCard, { refillChip, URGENT_REFILLS_NOTE } from "$components/RefillsCard.svelte";
  import Button from "$components/ui/Button.svelte";
  import QuickLogBar from "$components/QuickLogBar.svelte";
  import DashboardHeader from "$components/dashboard/DashboardHeader.svelte";
  import DueCard from "$components/dashboard/DueCard.svelte";
  import DoneList, { restoredDoneRowFocus } from "$components/dashboard/DoneList.svelte";
  import LaterList from "$components/dashboard/LaterList.svelte";
  import DoseActionForm from "$components/dashboard/DoseActionForm.svelte";
  import { createDashboardClock, setDashboardClock } from "$components/dashboard/dashboard-clock";
  import SectionEditBar from "$components/dashboard/SectionEditBar.svelte";
  import EditToolbar from "$components/dashboard/EditToolbar.svelte";
  import {
    createLayoutDraft,
    draftPreset,
    type LayoutDraft,
  } from "$components/dashboard/dashboard-editor.svelte";
  import {
    CUSTOMISE_HEADING_ID,
    DASHBOARD_EDITOR_ID,
    DONE_HEADING_ID,
  } from "$components/dashboard/dom-ids";
  import { STILL_SAVING_TOAST } from "$components/dose-writes/copy";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import { pageHeading } from "$components/dose-writes/focus-after";
  import { showToast } from "$components/ui/Toast.svelte";
  import { formatDoseLabel, toastForDoseRemoved } from "$lib/utils/dashboard-copy";
  import { formatUserTime, type DateFormat, type TimeFormat } from "$lib/utils/time";
  import type { DoseLogWithMedication, RefillForecastEntry } from "$lib/types";
  import {
    HIDEABLE_SECTIONS,
    normaliseOption,
    normaliseSectionOrder,
    resolveDashboardLayout,
    SECTION_LABELS,
    type DashboardSectionId,
  } from "$lib/dashboard/layout";
  import { moveFocusTarget } from "$lib/dashboard/move-focus";
  import { PRESETS, type PresetId } from "$lib/dashboard/presets";
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

  // Edit mode (spec §5b, §5d). The draft is created from `stored` on
  // entering and discarded once leaving has reloaded: it outlives `editing`
  // only while its last writes settle, so the page keeps rendering the
  // user's last change rather than a payload that predates it. Component
  // state, so a remount or a navigation always starts out of edit mode.
  // Everything a change makes is saved as it is made, by the draft.
  let editing = $state(false);
  let draft = $state<LayoutDraft | null>(null);
  // The footer is a link until mounted (the no-JS path, and a press before
  // hydration navigates rather than landing on a dead button).
  let hydrated = $state(false);
  let destroyed = false;
  onMount(() => {
    hydrated = true;
    return () => {
      destroyed = true;
    };
  });
  let footerControl = $state<HTMLButtonElement | HTMLAnchorElement | null>();
  // Read only, never acquired: entering mid-write would let that write's
  // reload re-render rows under the editor mid-gesture.
  const lock = getDoseWriteLock();

  // What the page renders: the draft while it exists (editing, or leaving
  // with writes still settling), the stored values otherwise. One resolver
  // call either way, so the preview is the page.
  const view = $derived(draft ? draft.values : stored);
  const variant = $derived(asNeededOnly ? "as-needed-only" : "scheduled");

  // Order and visibility only. What each section holds is the composer's.
  const layout = $derived(
    resolveDashboardLayout({
      order: view.order,
      showLater: view.showLater,
      showQuickLog: view.showQuickLog,
      showRefills: view.showRefills,
      variant,
      hasUrgentRefill: data.refillForecast.some(needsYou),
    }),
  );
  const refillEntries = $derived(
    layout.refillsUrgentOnly ? data.refillForecast.filter(needsYou) : data.refillForecast,
  );
  const quickLogShown = $derived(
    layout.pinned === "quickLog" || layout.sections.includes("quickLog"),
  );
  // Every section the variant has, shown or hidden, in the draft's order:
  // what edit mode draws, and what its ↑/↓ positions count.
  const editOrder = $derived(normaliseSectionOrder(view.order, variant));
  const hiddenIds = $derived(new Set(layout.hidden));
  const activeId = $derived(editing && draft ? draftPreset(draft.values) : null);

  // Once per payload, never twice for the same one: a repeat would spend
  // the draft's stale-payload guard and re-apply the value it was ignoring.
  // Keyed on the payload object, and nothing else is tracked.
  let syncedData: unknown = null;
  $effect.pre(() => {
    const payload = data;
    untrack(() => {
      if (!draft || payload === syncedData) return;
      syncedData = payload;
      draft.sync(stored);
    });
  });

  let announcement = $state("");
  // A live region does not re-announce an unchanged string, so every other
  // announcement carries a trailing zero-width space (the settings page's
  // trick).
  let announceParity = false;
  function announce(text: string) {
    announceParity = !announceParity;
    announcement = `${text}${announceParity ? "\u200b" : ""}`;
  }

  async function enter() {
    if (lock.active) {
      showToast(STILL_SAVING_TOAST, "error", { coalesce: true });
      return;
    }
    // A draft still settling from the last Done is the newest picture of
    // the layout, and its writes are in flight: keep it rather than start a
    // second one from a payload that predates them.
    if (!draft) {
      draft = createLayoutDraft(stored);
      syncedData = data;
    }
    editing = true;
    announce("Customising. Changes save as you make them.");
    await tick();
    document.getElementById(CUSTOMISE_HEADING_ID)?.focus({ preventScroll: true });
  }

  /**
   * Done and Escape. Nothing to save: every change already was. Edit mode
   * ends and focus moves at once; the reload waits for the draft's writes,
   * because a reload served before one commits carries the old value and
   * the draft's stale-payload guard is the only thing that ignores it.
   */
  let leaveTicket = 0;
  async function leave() {
    if (!editing) return;
    editing = false;
    const leaving = draft;
    const ticket = ++leaveTicket;
    await tick();
    if (footerControl?.isConnected) footerControl.focus();
    else pageHeading()?.focus({ preventScroll: true });
    await leaving?.settled();
    // Re-entered while the writes settled: the draft is in use again, and
    // that edit session's own Done reloads (once, by the latest ticket).
    if (editing || destroyed || ticket !== leaveTicket) return;
    try {
      // Render the server's truth rather than the draft's last picture of it.
      await invalidateAll();
    } finally {
      if (!editing && draft === leaving) draft = null;
    }
  }

  /**
   * The toolbar's More options. Like Done, it waits for the draft's writes
   * (leave()'s settle step) before going: the settings page loads the stored
   * values, and one loaded before a write commits shows the old value.
   */
  async function openMoreOptions(href: string) {
    await draft?.settled();
    if (destroyed) return;
    // eslint-disable-next-line svelte/no-navigation-without-resolve -- a fixed in-app path with a query string
    await goto(href);
  }

  function onRegionKeydown(event: KeyboardEvent) {
    if (!editing || event.key !== "Escape") return;
    event.preventDefault();
    leave();
  }

  /** The belt for `inert`: no form inside the page submits while editing. Capture runs before any form's own listener. */
  function guardSubmit(event: SubmitEvent) {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const EDITOR_MOVE = "editor-move";

  async function moveSectionBy(id: DashboardSectionId, direction: "up" | "down") {
    if (!draft) return;
    const before = editOrder.indexOf(id);
    draft.move(id, direction, variant);
    // Refused offline: the draft toasted and nothing moved, so say nothing.
    const position = editOrder.indexOf(id);
    if (position === before) return;
    announce(`${SECTION_LABELS[id]} moved to position ${position + 1} of ${editOrder.length}`);
    await tick();
    const isEnd = direction === "up" ? position === 0 : position === editOrder.length - 1;
    document.getElementById(moveFocusTarget(EDITOR_MOVE, id, direction, isEnd))?.focus();
  }

  type Hideable = (typeof HIDEABLE_SECTIONS)[number];
  const isHideable = (id: DashboardSectionId): id is Hideable =>
    (HIDEABLE_SECTIONS as readonly string[]).includes(id);
  const SHOWN = { later: "showLater", quickLog: "showQuickLog", refills: "showRefills" } as const;

  function setShown(id: Hideable, value: boolean) {
    if (!draft) return;
    draft.setShown(id, value);
    if (view[SHOWN[id]] !== value) return; // refused offline
    const label = SECTION_LABELS[id];
    announce(
      value
        ? `${label} shown`
        : id === "refills"
          ? `${label} hidden. Refills that need you still show`
          : `${label} hidden`,
    );
  }

  function applyPreset(id: PresetId) {
    if (!draft) return;
    draft.applyPreset(id);
    if (draftPreset(draft.values) !== id) return; // refused offline
    announce(`${PRESETS[id].label} applied`);
  }

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
      timeDisplay={view.doneTime}
      onedit={(dose) => (editingDose = dose)}
    />
  {:else if id === "later"}
    <LaterList
      rows={data.later}
      mode={view.laterMode}
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

<!-- The pinned Due region, drawn the same way in and out of edit mode. -->
{#snippet due()}
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
{/snippet}

{#if data.medications.length === 0}
  <OnboardingWelcome />
{:else}
  <!-- onsubmitcapture is the belt for `inert` while editing: old iOS PWAs
       lack it, and requestSubmit() ignores it. A capture listener on an
       ancestor runs before any form's own enhance listener. -->
  <div class="mx-auto w-full max-w-2xl space-y-6" onsubmitcapture={guardSubmit}>
    <DashboardHeader
      status={data.status}
      serverNow={renderNow}
      timezone={data.timezone}
      {timeFormat}
      {dateFormat}
    />

    <!-- The page's one polite region for edit mode, rendered before it is
         needed so its first announcement is heard. Failures are toasts. -->
    <p role="status" class="sr-only">{announcement}</p>

    <!-- Always rendered, so the footer control's aria-controls resolves; a
         named region only while editing. Escape is handled here rather than
         on the document, so it never fights Modal or the help overlay. -->
    <div
      id={DASHBOARD_EDITOR_ID}
      role={editing ? "region" : undefined}
      aria-labelledby={editing ? CUSTOMISE_HEADING_ID : undefined}
      class="space-y-6"
      onkeydown={onRegionKeydown}
    >
      {#if editing}
        <h2
          id={CUSTOMISE_HEADING_ID}
          tabindex="-1"
          class="text-text-primary text-lg font-semibold focus:outline-none"
        >
          Customising your dashboard
        </h2>

        <!-- The pinned block keeps its place and gets a bar with no controls.
             Every section's content is inert: it still renders live from the
             payload, and nothing in it can be reached or tapped. -->
        {#if layout.pinned === "quickLog"}
          <div data-edit-pinned class="space-y-2">
            <SectionEditBar id="quickLog" label="Log a dose · always first on your account" />
            <div inert>{@render chips("Log a dose")}</div>
          </div>
        {:else if hasDue}
          <div data-edit-pinned class="space-y-2">
            <SectionEditBar id="due" label="Due now · always first while something is due" />
            <div inert>{@render due()}</div>
          </div>
        {/if}

        {#each editOrder as id, index (id)}
          {@const hidden = hiddenIds.has(id)}
          <div data-edit-section={id} class="space-y-2">
            <SectionEditBar
              {id}
              label={SECTION_LABELS[id]}
              {hidden}
              note={id === "refills" && layout.refillsUrgentOnly ? URGENT_REFILLS_NOTE : undefined}
              movePrefix={EDITOR_MOVE}
              move={{
                atStart: index === 0,
                atEnd: index === editOrder.length - 1,
                onmove: (direction) => moveSectionBy(id, direction),
              }}
              shown={isHideable(id)
                ? { pressed: view[SHOWN[id]], onchange: (value) => setShown(id, value) }
                : "always"}
            />
            <div inert class={hidden ? "opacity-50" : undefined}>{@render section(id)}</div>
          </div>
        {/each}

        <EditToolbar
          active={activeId}
          onpreset={applyPreset}
          ondone={leave}
          onmore={openMoreOptions}
        />
      {:else}
        <!-- The pinned block sits outside the account's order, so "Due
             first" holds by construction rather than by a sort. -->
        {#if layout.pinned === "quickLog"}
          <!-- No active medication has an interval or fixed-time schedule, so
               nothing can be due: the chips are the page. -->
          {@render chips("Log a dose")}
        {:else if hasDue}
          {@render due()}
        {/if}

        {#each layout.sections as id (id)}
          {@render section(id)}
        {/each}
      {/if}
    </div>

    <div>
      {#if hydrated}
        <!-- After mount, the same control opens edit mode in place. -->
        <Button
          variant="ghost"
          size="sm"
          bind:ref={footerControl}
          aria-expanded={editing}
          aria-controls={DASHBOARD_EDITOR_ID}
          onclick={() => (editing ? leave() : enter())}
        >
          {footerLine(layout.hidden)}
        </Button>
      {:else}
        <Button variant="ghost" size="sm" href="/settings/dashboard?from=dashboard">
          {footerLine(layout.hidden)}
        </Button>
      {/if}
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

<KeyboardShortcuts medications={data.medications} quickLog={quickLogShown} {editing} />
