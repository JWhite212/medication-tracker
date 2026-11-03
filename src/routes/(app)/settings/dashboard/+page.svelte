<script lang="ts">
  import { tick } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { applyAction, enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { page } from "$app/state";
  import {
    DEFAULT_ORDER,
    SECTION_LABELS,
    SHORT_SECTION_LABELS,
    mergeVisibleOrder,
    moveSection,
    normaliseOption,
    normaliseSectionOrder,
    orderValue,
    type DashboardSectionId,
  } from "$lib/dashboard/layout";
  import { moveFocusTarget } from "$lib/dashboard/move-focus";
  import { PRESET_IDS, PRESETS, activePreset } from "$lib/dashboard/presets";
  import {
    DASHBOARD_LATER_MODES,
    DONE_TIME_DISPLAYS,
    type DashboardLaterMode,
    type DoneTimeDisplay,
  } from "$lib/preferences/domains";
  import { formatTimeSince, formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { focusIfLost, pageHeading } from "$lib/components/dose-writes/focus-after";
  import { actionErrorMessage } from "$lib/utils/form-errors";
  import { showToast } from "$lib/components/ui/Toast.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Toggle from "$lib/components/ui/Toggle.svelte";

  let { data } = $props();

  // Everything below is derived from server-confirmed data. There is no
  // optimistic state: a press posts the complete resulting value, and the page
  // changes only when the reload after it lands.
  const preferences = $derived(data.preferences);
  const order = $derived(normaliseSectionOrder(preferences.dashboardSectionOrder, data.variant));
  // Every id the account stores, placed as the scheduled page would place
  // them. A move posts `order`'s change written back into this, so an
  // as-needed-only account's stored places for Later and Quick log survive
  // a reorder of the two sections it can see. On a scheduled account the two
  // orders are the same and the posted value is exactly `moveSection(order)`.
  const fullOrder = $derived(normaliseSectionOrder(preferences.dashboardSectionOrder, "scheduled"));
  // Reset applies Standard, which restores Later's and Done's options as
  // well as the order and visibility, so the label names the layout and only
  // then lists the sections this variant's Standard page shows.
  const resetLabel = $derived(
    `Reset to ${PRESETS.standard.label}: ${DEFAULT_ORDER[data.variant].map((id) => SHORT_SECTION_LABELS[id]).join(", ")}`,
  );
  const shown = $derived({
    later: preferences.dashboardShowLater,
    quickLog: preferences.dashboardShowQuickLog,
    refills: preferences.dashboardShowRefills,
  });
  // `[]` is non-null, so an account an API client gave an empty order still
  // sees the default page and is still offered the way back (Review Focus 1).
  // The two single-choice options. Read tolerantly, like the dashboard does.
  const laterMode = $derived(
    normaliseOption(preferences.dashboardLaterMode, DASHBOARD_LATER_MODES, "next"),
  );
  const doneTime = $derived(
    normaliseOption(preferences.dashboardDoneTime, DONE_TIME_DISPLAYS, "both"),
  );
  // Reset now means Standard, so it is offered whenever any of the six
  // preset keys is off Standard's value.
  const customised = $derived(
    preferences.dashboardSectionOrder !== null ||
      !shown.later ||
      !shown.quickLog ||
      !shown.refills ||
      laterMode !== PRESETS.standard.patch.dashboardLaterMode ||
      doneTime !== PRESETS.standard.patch.dashboardDoneTime,
  );
  // Matched from the confirmed values, never stored. The two options go
  // through the same tolerant read as above so an unknown value matches
  // Standard's default, like the dashboard.
  const activeId = $derived(
    activePreset({
      dashboardSectionOrder: preferences.dashboardSectionOrder,
      dashboardShowLater: preferences.dashboardShowLater,
      dashboardShowQuickLog: preferences.dashboardShowQuickLog,
      dashboardShowRefills: preferences.dashboardShowRefills,
      dashboardLaterMode: laterMode,
      dashboardDoneTime: doneTime,
    }),
  );
  const LATER_OPTIONS: { value: DashboardLaterMode; label: string }[] = [
    { value: "next", label: "Next few" },
    { value: "all", label: "Whole day" },
  ];
  const DONE_OPTIONS: { value: DoneTimeDisplay; label: string }[] = [
    { value: "both", label: "Time and how long ago" },
    { value: "since", label: "How long ago" },
    { value: "clock", label: "Time only" },
  ];
  // A fixed dose taken 2h 15m before a fixed "now", run through the same
  // formatters the dashboard uses, so the sample cannot drift from the page.
  const SAMPLE_NOW = new Date("2026-04-15T12:00:00.000Z");
  const SAMPLE_TAKEN = new Date(SAMPLE_NOW.getTime() - (2 * 60 + 15) * 60_000);
  const doneSample = $derived.by(() => {
    const clock = formatUserTime(
      SAMPLE_TAKEN,
      data.user.timezone,
      preferences.timeFormat as TimeFormat,
    );
    const since = formatTimeSince(SAMPLE_TAKEN, SAMPLE_NOW, preferences.timeSinceDaysFromHours);
    return { both: `${clock}, ${since}`, since, clock } satisfies Record<DoneTimeDisplay, string>;
  });
  const fromDashboard = $derived(page.url.searchParams.get("from") === "dashboard");

  const FLAG_KEY = {
    later: "dashboardShowLater",
    quickLog: "dashboardShowQuickLog",
    refills: "dashboardShowRefills",
  } as const;
  type HideableId = keyof typeof FLAG_KEY;
  const isHideable = (id: DashboardSectionId): id is HideableId => id in FLAG_KEY;

  type Intent =
    | { kind: "move"; id: DashboardSectionId; direction: "up" | "down" }
    | { kind: "visibility"; id: HideableId }
    | { kind: "option"; key: "laterMode" | "doneTime" }
    | { kind: "preset" }
    | { kind: "reset" };

  // One page-level flag. While a save is in flight every control is
  // aria-disabled (never `disabled`, which drops focus to <body>) and a press
  // is cancelled, so two quick ↑ presses can never post two orders computed
  // from the same confirmed state (Review Focus 4). This is not a dose write:
  // it takes no dose-write lock.
  let saving = $state(false);

  let announcement = $state("");
  // Alternates on every announcement: a live region does not re-announce an
  // unchanged string, so a repeat carries a trailing zero-width space.
  let announceParity = false;
  function announce(text: string) {
    announceParity = !announceParity;
    announcement = `${text}${announceParity ? "\u200b" : ""}`;
  }

  // Read after the reload, from confirmed data. An intent is fixed when its
  // form mounts (enhance has no update hook), so it names only what never
  // changes for that form: the section and the direction.
  function messageFor(intent: Intent): string {
    if (intent.kind === "move") {
      const position = order.indexOf(intent.id) + 1;
      return `${SECTION_LABELS[intent.id]} moved to position ${position} of ${order.length}`;
    }
    if (intent.kind === "visibility") {
      return `${SECTION_LABELS[intent.id]} ${shown[intent.id] ? "shown" : "hidden"}`;
    }
    if (intent.kind === "option") {
      return intent.key === "laterMode"
        ? `${SECTION_LABELS.later}: ${LATER_OPTIONS.find((o) => o.value === laterMode)!.label.toLowerCase()}`
        : `${SECTION_LABELS.done}: ${DONE_OPTIONS.find((o) => o.value === doneTime)!.label.toLowerCase()}`;
    }
    // One form serves all four presets, so the intent cannot name which; the
    // reload has made the applied preset the active one.
    if (intent.kind === "preset")
      return activeId ? `${PRESETS[activeId].label} applied` : "Preset applied";
    return `Dashboard reset to ${PRESETS.standard.label}`;
  }

  const MOVE_PREFIX = "settings-move";

  /**
   * Focus after a move: the button just pressed, unless the move took the
   * section to an end and made it inert, then its opposite. Unconditional, as
   * on /medications, rather than only when focus was lost: the pressed button
   * survives the reorder and keeps focus while it becomes aria-disabled.
   */
  function focusMoved(id: DashboardSectionId, direction: "up" | "down") {
    const same = document.getElementById(`${MOVE_PREFIX}-${id}-${direction}`);
    const isEnd = !same || same.getAttribute("aria-disabled") === "true";
    const target = document.getElementById(moveFocusTarget(MOVE_PREFIX, id, direction, isEnd));
    target?.focus();
  }

  function save(intent: Intent): SubmitFunction {
    return ({ cancel }) => {
      if (saving) {
        cancel();
        return;
      }
      saving = true;
      return async ({ result }) => {
        try {
          if (result.type === "success") {
            await invalidateAll();
            // Released before focus is placed, so the only aria-disabled
            // buttons left are the ends the new order produced.
            saving = false;
            announce(messageFor(intent));
            if (intent.kind === "move") {
              await tick();
              focusMoved(intent.id, intent.direction);
            } else if (intent.kind === "reset") {
              // The reload made the page uncustomised, which removed the
              // Reset button that held focus. Park it on the h1 rather than
              // leave the next Tab to start from the top of the document.
              await tick();
              focusIfLost(pageHeading);
            }
          } else if (result.type === "redirect") {
            await applyAction(result);
          } else {
            // Nothing to undo: the page only ever drew confirmed data.
            showToast(
              actionErrorMessage(result, "Couldn't save your dashboard layout — please try again."),
              "error",
            );
          }
        } finally {
          saving = false;
        }
      };
    };
  }
</script>

<svelte:head>
  <title>Dashboard settings — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    {#if fromDashboard}
      <a href="/dashboard" class="text-text-muted hover:text-text-primary text-sm"
        >← Back to dashboard</a
      >
    {:else}
      <a href="/settings" class="text-text-muted hover:text-text-primary text-sm">← Settings</a>
    {/if}
    <span class="text-text-muted">/</span>
    <h1 tabindex="-1" class="text-2xl font-bold">Dashboard</h1>
  </div>

  <!-- The page's one polite region, before the first form, so a control is
       not re-announced when its own state changes. Failures are toasts. -->
  <p role="status" class="sr-only">{announcement}</p>

  <GlassCard>
    <fieldset data-presets class="min-w-0">
      <legend class="mb-1 text-lg font-semibold">Start from</legend>
      <p class="text-text-muted mb-3 text-sm">
        A starting point for the sections and options below. Change anything afterwards.
      </p>
      <form
        method="POST"
        action="?/applyPreset"
        use:enhance={save({ kind: "preset" })}
        class="space-y-2"
      >
        {#each PRESET_IDS as id (id)}
          <div>
            <Toggle
              size="md"
              pressed={activeId === id}
              submit={{ name: "preset", value: id }}
              aria-disabled={saving ? "true" : undefined}>{PRESETS[id].label}</Toggle
            >
            <p class="text-text-muted mt-1 text-sm">{PRESETS[id].blurb}</p>
          </div>
        {/each}
      </form>
      {#if activeId === null}
        <p data-custom class="text-text-secondary mt-3 text-sm">Custom: your own arrangement</p>
      {/if}
    </fieldset>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-1 text-lg font-semibold">Sections</h2>
    <p class="text-text-muted mb-4 text-sm">The order your dashboard shows them in.</p>

    <!-- Above the list, not in it: the pinned region cannot move, and as an
         item it would make "Done today" item 2 of a list whose visible
         numbers and announcements call it position 1. -->
    <p
      data-pinned
      class="border-glass-border text-text-secondary mb-2 rounded-lg border px-4 py-3 text-sm"
    >
      {#if data.variant === "scheduled"}
        Due now: always first whenever something is due, so nothing overdue sits below the fold.
      {:else}
        Log a dose: always first
      {/if}
    </p>

    <ol data-sections class="space-y-2">
      {#each order as id, index (id)}
        {@const label = SECTION_LABELS[id]}
        <li data-section={id} class="border-glass-border rounded-lg border px-4 py-2">
          <div class="flex flex-wrap items-center gap-2">
            <span data-position class="text-text-muted w-5 text-sm tabular-nums">{index + 1}</span>
            <span class="min-w-0 flex-1 font-medium">{label}</span>

            {#each ["up", "down"] as const as direction (direction)}
              {@const atEnd = direction === "up" ? index === 0 : index === order.length - 1}
              <form
                method="POST"
                action="?/dashboardSectionOrder"
                use:enhance={save({ kind: "move", id, direction })}
              >
                <!-- One element either way, so the pressed button survives a
                     move that makes it an end. At an end it is inert: a plain
                     button with nothing to post. -->
                <IconButton
                  id="{MOVE_PREFIX}-{id}-{direction}"
                  type={atEnd ? "button" : "submit"}
                  label="Move {label} {direction}"
                  name={atEnd ? undefined : "dashboardSectionOrder"}
                  value={atEnd
                    ? undefined
                    : orderValue(mergeVisibleOrder(moveSection(order, id, direction), fullOrder))}
                  aria-disabled={atEnd || saving ? "true" : undefined}
                >
                  <span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span>
                </IconButton>
              </form>
            {/each}

            {#if isHideable(id)}
              <form
                method="POST"
                action="?/{FLAG_KEY[id]}"
                use:enhance={save({ kind: "visibility", id })}
              >
                <Toggle
                  size="md"
                  pressed={shown[id]}
                  submit={{ name: FLAG_KEY[id], value: shown[id] ? "off" : "on" }}
                  aria-disabled={saving ? "true" : undefined}>Show {label}</Toggle
                >
              </form>
            {:else}
              <span class="text-text-muted text-sm">Always shown</span>
            {/if}
          </div>

          {#if id === "quickLog" && !shown.quickLog}
            <p class="text-text-muted mt-1 text-sm">1–9 shortcuts are off while hidden</p>
          {:else if id === "refills" && !shown.refills}
            <p class="text-text-muted mt-1 text-sm">Urgent refills still appear</p>
          {/if}
        </li>
      {/each}
    </ol>

    {#if customised}
      <form
        method="POST"
        action="?/resetDashboardLayout"
        use:enhance={save({ kind: "reset" })}
        class="mt-4"
      >
        <Button variant="secondary" type="submit" ariaDisabled={saving}>{resetLabel}</Button>
      </form>
    {/if}
  </GlassCard>

  <GlassCard>
    <h2 class="mb-1 text-lg font-semibold">Options</h2>
    <p class="text-text-muted mb-4 text-sm">How much each section shows.</p>

    <div class="space-y-5">
      <fieldset data-option-group="dashboardLaterMode" class="min-w-0">
        <legend class="mb-2 font-medium">{SECTION_LABELS.later}</legend>
        <form
          method="POST"
          action="?/dashboardLaterMode"
          use:enhance={save({ kind: "option", key: "laterMode" })}
          class="flex flex-wrap gap-2"
        >
          {#each LATER_OPTIONS as option (option.value)}
            <Toggle
              size="md"
              pressed={laterMode === option.value}
              submit={{ name: "dashboardLaterMode", value: option.value }}
              aria-disabled={saving ? "true" : undefined}>{option.label}</Toggle
            >
          {/each}
        </form>
        {#if !shown.later}
          <p class="text-text-muted mt-1 text-sm">Later today is hidden</p>
        {/if}
      </fieldset>

      <fieldset data-option-group="dashboardDoneTime" class="min-w-0">
        <legend class="mb-2 font-medium">{SECTION_LABELS.done}</legend>
        <form
          method="POST"
          action="?/dashboardDoneTime"
          use:enhance={save({ kind: "option", key: "doneTime" })}
          class="flex flex-wrap gap-2"
        >
          {#each DONE_OPTIONS as option (option.value)}
            <Toggle
              size="md"
              pressed={doneTime === option.value}
              submit={{ name: "dashboardDoneTime", value: option.value }}
              aria-disabled={saving ? "true" : undefined}>{option.label}</Toggle
            >
          {/each}
        </form>
        <p data-done-sample class="text-text-muted mt-1 text-sm">
          Looks like: <span class="text-text-secondary tabular-nums">{doneSample[doneTime]}</span>
        </p>
      </fieldset>
    </div>
  </GlassCard>

  <p class="text-text-muted text-sm">
    To choose when time since a dose switches from hours to days, use
    <a href="/settings/appearance" class="text-accent-ink underline"
      >Show days instead of hours after</a
    >
    on Appearance.
  </p>
</div>
