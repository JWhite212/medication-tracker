<script lang="ts">
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import TimeSince from "$components/TimeSince.svelte";
  import { createDoseWrite } from "$components/dose-writes/dose-write.svelte";
  import { focusTargetAfterResolve } from "$components/dose-writes/focus-after";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { formatDoseLabel, toastForDoseRemoved } from "$lib/utils/dashboard-copy";
  import type { DoseLogWithMedication } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";

  let {
    dose,
    timezone,
    timeFormat = "12h",
    day,
    onedit,
  }: {
    dose: DoseLogWithMedication;
    timezone: string;
    timeFormat?: TimeFormat;
    /**
     * This row's day group, or null for Today. Only the Undo offer reads it,
     * to say which day's dose went. `isYesterday` is the page's answer from
     * day KEYS; `label` is the group's heading ("Tue 23 Sep"), used only for
     * an older day. Yesterday is never recognised by its heading's wording,
     * so rewording the heading cannot change the toast.
     */
    day: { label: string; isYesterday: boolean } | null;
    onedit?: (dose: DoseLogWithMedication) => void;
  } = $props();

  // × deletes on the first tap and the toast offers Undo, as every dose
  // control on the dashboard does. It used to open an inline "This can't be
  // undone" confirmation instead, which existed only because nothing could
  // put a deleted dose back. The server's trash now can, for ten minutes.
  //
  // × is a submit only once this row has mounted. Before hydration, or with
  // scripts off, a native POST would delete with no Undo toast to take it
  // back, so until then × is an inert type="button", as it always was
  // before JavaScript arrived.
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });

  let row: HTMLDivElement | undefined = $state();

  // The log page renders one of these per dose — twenty on a default page — and
  // both controls were named by a bare constant, so the button list read
  // "Edit dose, Delete dose" twenty times over with no way to tell which row.
  const takenTime = $derived(formatUserTime(new Date(dose.takenAt), timezone, timeFormat));

  // Which rows were rendered below and above this one when × was pressed,
  // nearest first, across every day group. After the reload this row is gone
  // and the DOM can no longer say. Taken in the capture phase on the row, so
  // it lands before enhance's own submit listener on the form reads the
  // options below.
  let neighbours: { following: string[]; preceding: string[] } = {
    following: [],
    preceding: [],
  };

  function snapshotNeighbours() {
    const ids = [...document.querySelectorAll<HTMLElement>("[data-dose-id]")].map(
      (el) => el.dataset.doseId ?? "",
    );
    const at = ids.indexOf(dose.id);
    neighbours =
      at === -1
        ? { following: [], preceding: [] }
        : { following: ids.slice(at + 1), preceding: ids.slice(0, at).reverse() };
  }

  const editButtonIn = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-edit]");

  const write = createDoseWrite(() => {
    // Every value the result handlers use is read NOW, at submit. They run
    // after the reload, which has usually unmounted this row, and must not
    // read the props of a destroyed component.
    const id = dose.id;
    const message = toastForDoseRemoved(
      formatDoseLabel(
        dose.medication.name,
        dose.medication.dosageAmount,
        dose.medication.dosageUnit,
      ),
      takenTime,
      day === null ? "today" : day.isYesterday ? "yesterday" : { on: day.label },
    );
    const { following, preceding } = neighbours;
    return {
      undo: {
        kind: "restore",
        // A restore brings back the same id, so this finds the restored row.
        focusTarget: () =>
          document.querySelector<HTMLElement>(`[data-dose-id="${id}"] [data-edit]`),
      },
      withdrawsUndoFor: id,
      buildToast: () => message,
      busyContainer: () => row ?? null,
      // The next row BELOW first (the list is newest-first, so that is the
      // next dose back in time), crossing into the next day's group; then the
      // nearest row above; then the page's h1. Always a ✎, never a ×: Enter
      // on a focused × is another delete.
      focusAfter: () =>
        focusTargetAfterResolve(id, following, {
          attr: "doseId",
          precedingKeys: preceding,
          pick: editButtonIn,
        }) ?? document.querySelector<HTMLElement>("h1"),
    };
  });
</script>

<!-- Clicking the row is a redundant mouse shortcut for the ✎ button inside it,
     which is a real <button> with its own accessible name and is reachable by
     keyboard. A key handler here would be dead code: role="listitem" is not
     focusable, so it can never receive one.
     data-dose-id, and data-edit on the ✎, are what focus lands on after a
     delete or its Undo, here and in the rows around it. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={row}
  data-dose-id={dose.id}
  class="group border-glass-border bg-glass hover:bg-glass-hover rounded-lg border p-4 backdrop-blur-xl transition-colors {onedit
    ? 'cursor-pointer'
    : ''}"
  role="listitem"
  onclick={() => onedit?.(dose)}
  onsubmitcapture={snapshotNeighbours}
>
  <!-- Below sm the time drops to its own line under the name. Inline at 320px,
       the time and the controls left the name (a flex-1 item with a zero
       basis) a few pixels at most, and that was before the controls grew to
       touch size. -->
  <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
    <!-- A skipped or missed row used to carry opacity-60 on the WHOLE row, which
         pulled the badges, dosage and time to roughly 3:1 (WCAG 1.4.3). The
         line-through and the Skipped/Missed badges already say what the row is;
         this dot is the one decorative part, so it is the only thing dimmed. -->
    <div
      class="h-3 w-3 shrink-0 rounded-full {dose.status !== 'taken' ? 'opacity-50' : ''}"
      style="background: {getMedicationBackground(
        dose.medication.colour,
        dose.medication.colourSecondary,
        dose.medication.pattern,
        true,
      )}"
    ></div>

    <div class="min-w-0 flex-1">
      <!-- break-words because a long one-word name has no space to wrap at,
           and at 320px it ran on underneath the controls. -->
      <p class="font-medium break-words">
        <span class={dose.status === "skipped" ? "line-through decoration-1" : ""}>
          {dose.medication.name}
        </span>
        <span class="text-text-secondary text-sm">
          {dose.medication.dosageAmount}{dose.medication.dosageUnit}
          {#if dose.status === "taken" && dose.quantity > 1}&times; {dose.quantity}{/if}
        </span>
        {#if dose.status === "skipped"}
          <span
            class="bg-warning/15 text-warning ml-2 rounded-full px-2 py-0.5 text-xs font-semibold tracking-wider uppercase"
          >
            Skipped
          </span>
        {:else if dose.status === "missed"}
          <span
            class="bg-danger/15 text-danger-ink ml-2 rounded-full px-2 py-0.5 text-xs font-semibold tracking-wider uppercase"
          >
            Missed
          </span>
        {/if}
      </p>
    </div>

    <div
      class="order-last flex basis-full items-center gap-4 pl-7 text-sm sm:order-none sm:basis-auto sm:pl-0"
    >
      <span class="text-text-secondary"
        >{formatUserTime(new Date(dose.takenAt), timezone, timeFormat)}</span
      >
      <span class="text-accent-ink font-medium">
        <TimeSince date={new Date(dose.takenAt)} />
      </span>
    </div>

    <!-- group-focus-within matters as much as group-hover: opacity-0 keeps these
         buttons focusable and in the accessibility tree, so a sighted keyboard
         user was tabbing onto controls they could not see (WCAG 2.4.7).
         The hide is gated on (hover: hover), the same query Tailwind v4 wraps
         group-hover in. Gated on width alone, a touch tablet at md width hid
         the controls, and the hover that reveals them never happens there.
         They also stay shown while a delete is in flight, so its spinner does
         not vanish when focus and pointer leave the row.
         Targets are 32px for a mouse and 44px for touch (WCAG 2.5.8, and 2.5.5
         on touch); the negative margin lets them reach into the row's padding
         instead of making every row taller. Below sm on touch they also reach
         down onto the time's line, which is in flow and painted after them, so
         a tap on the bottom of × landed on that line and opened the edit modal.
         Positioning them (relative) lifts them above it.
         The click handler is a boundary: a tap in the gap between ✎ and × is a
         near miss of a control, not a tap on the row. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onclick={(e) => e.stopPropagation()}
      class="relative -my-1 flex items-center gap-1 opacity-100 transition-opacity pointer-coarse:-my-2.5 {write.pending
        ? ''
        : 'md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:[@media(hover:hover)]:opacity-0'}"
    >
      {#if onedit}
        <button
          type="button"
          data-edit
          onclick={(e) => {
            e.stopPropagation();
            onedit?.(dose);
          }}
          class="text-text-muted hover:text-accent-ink inline-flex size-8 items-center justify-center text-xs pointer-coarse:size-11"
          aria-label="Edit dose of {dose.medication.name} at {takenTime}"
        >
          ✎
        </button>
      {/if}
      <!-- The form wraps × alone, so no other button in the row can ever
           submit a delete. display: contents keeps × a flex item of this row
           of controls, with their size and gap. -->
      <form method="POST" action="?/deleteDose" class="contents" use:enhance={write.submit}>
        <input type="hidden" name="doseId" value={dose.id} />
        <!-- aria-disabled, never `disabled`, which drops keyboard focus to
             <body>; a busy tap is cancelled in the submit instead. -->
        <button
          type={mounted ? "submit" : "button"}
          onkeydown={write.onkeydown}
          aria-disabled={write.busy ? "true" : undefined}
          class="text-text-muted hover:text-danger-ink inline-flex size-8 items-center justify-center text-xs aria-disabled:cursor-not-allowed pointer-coarse:size-11"
          aria-label="Delete dose of {dose.medication.name} at {takenTime}"
        >
          {#if write.pending}
            <span
              class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            ></span>
          {:else}
            &times;
          {/if}
        </button>
      </form>
    </div>
  </div>

  {#if dose.sideEffects && dose.sideEffects.length > 0}
    <div class="mt-2 flex flex-wrap gap-1.5 pl-7">
      {#each dose.sideEffects as effect}
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium {effect.severity === 'severe'
            ? 'bg-danger/15 text-danger-ink'
            : effect.severity === 'moderate'
              ? 'bg-warning/15 text-warning'
              : 'bg-text-secondary/30 text-text-primary'}"
        >
          {effect.name}
        </span>
      {/each}
    </div>
  {/if}
</div>
