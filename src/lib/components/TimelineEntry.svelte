<script lang="ts">
  import { tick } from "svelte";
  import { enhance } from "$app/forms";
  import TimeSince from "$components/TimeSince.svelte";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { showToast } from "$components/ui/Toast.svelte";
  import type { DoseLogWithMedication } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import { actionErrorMessage } from "$lib/utils/form-errors";

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

  let deleting = $state(false);

  // × used to submit ?/deleteDose on the first tap: no confirmation and no
  // undo, on a small target in a list of near-identical rows, so a mis-tap
  // permanently removed a dose and reversed its inventory adjustment. It now
  // only opens an inline confirmation, and the dose goes only when that
  // confirmation's own Delete button is pressed. An Undo toast would be the
  // lighter touch, but recreating a deleted dose is a server change this
  // component cannot make on its own.
  // The cost is that × needs JavaScript, where the old submit button posted
  // without it: before hydration, or with scripts off, it does nothing. That
  // fails safe, and the row's edit modal needs JavaScript already. A native
  // disclosure could keep a scriptless path, but not without rebuilding the
  // row around it.
  let confirming = $state(false);
  let row: HTMLDivElement | undefined = $state();
  let deleteButton: HTMLButtonElement | undefined = $state();
  let cancelButton: HTMLButtonElement | undefined = $state();
  let confirmGroup: HTMLDivElement | undefined = $state();
  const uid = $props.id();
  const confirmId = `${uid}-delete-confirm`;

  // The log page renders one of these per dose — twenty on a default page — and
  // both controls were named by a bare constant, so the button list read
  // "Edit dose, Delete dose" twenty times over with no way to tell which row.
  const takenTime = $derived(formatUserTime(new Date(dose.takenAt), timezone, timeFormat));

  async function openConfirm() {
    confirming = true;
    await tick();
    // Cancel, not Delete: pressing Enter twice on × must not delete either.
    cancelButton?.focus();
  }

  async function closeConfirm() {
    // Hand focus back to × only if the confirmation held it, or dropped it on
    // <body> when its buttons were disabled. A slow request can fail after
    // the user has moved on, and pulling focus back then would be worse.
    const active = document.activeElement;
    const reclaim =
      !active ||
      active === document.body ||
      active === deleteButton ||
      !!confirmGroup?.contains(active);
    confirming = false;
    // After a failed delete, × is still disabled until this flush lands, and
    // focus() on a disabled button is silently ignored.
    await tick();
    if (reclaim) deleteButton?.focus();
  }

  function onConfirmKeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !confirming || deleting) return;
    closeConfirm();
  }

  // The row beside this one in its list, next in preference to previous: the
  // one that will stand in this row's place once it has gone.
  function neighbourRow(): HTMLElement | undefined {
    return [row?.nextElementSibling, row?.previousElementSibling].find(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[role="listitem"]'),
    );
  }
</script>

<!-- Clicking the row is a redundant mouse shortcut for the ✎ button inside it,
     which is a real <button> with its own accessible name and is reachable by
     keyboard. A key handler here would be dead code: role="listitem" is not
     focusable, so it can never receive one. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={row}
  class="group border-glass-border bg-glass hover:bg-glass-hover rounded-lg border p-4 backdrop-blur-xl transition-colors {onedit
    ? 'cursor-pointer'
    : ''}"
  role="listitem"
  onclick={() => onedit?.(dose)}
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
         They also stay shown while a delete is being confirmed: × is that
         confirmation's toggle, and would otherwise vanish once focus and
         pointer left the row.
         Targets are 32px for a mouse and 44px for touch (WCAG 2.5.8, and 2.5.5
         on touch); the negative margin lets them reach into the row's padding
         instead of making every row taller. Below sm on touch they also reach
         down onto the time's line, which is in flow and painted after them, so
         a tap on the bottom of × landed on that line and opened the edit modal.
         Positioning them (relative) lifts them above it.
         The click handler is a boundary, as on the confirmation below: a tap
         in the gap between ✎ and × is a near miss of a control, not a tap on
         the row. -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      onclick={(e) => e.stopPropagation()}
      class="relative -my-1 flex items-center gap-1 opacity-100 transition-opacity pointer-coarse:-my-2.5 {confirming
        ? ''
        : 'md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:[@media(hover:hover)]:opacity-0'}"
    >
      {#if onedit}
        <button
          type="button"
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
      <button
        type="button"
        bind:this={deleteButton}
        onclick={(e) => {
          e.stopPropagation();
          if (confirming) closeConfirm();
          else openConfirm();
        }}
        onkeydown={onConfirmKeydown}
        class="text-text-muted hover:text-danger-ink aria-expanded:text-danger-ink inline-flex size-8 items-center justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11"
        aria-label="Delete dose of {dose.medication.name} at {takenTime}"
        aria-expanded={confirming}
        aria-controls={confirming ? confirmId : undefined}
        disabled={deleting}
      >
        &times;
      </button>
    </div>
  </div>

  {#if confirming}
    <!-- Its own line, inset under the name, and × does not move when it opens:
         the second tap of a double-tap lands where the first did, which is
         still ×, and closes this again. Nothing that deletes ever appears
         under the pointer that opened it. The prompt keeps a line to itself
         for the same reason; sharing one with the buttons pushed Delete out
         beneath × at some widths.
         The click handler is a boundary, not an interaction: without it a tap
         on the prompt or between the buttons would reach the row and open the
         edit modal over the question being asked. -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={confirmGroup}
      id={confirmId}
      role="group"
      aria-labelledby="{confirmId}-prompt"
      class="mt-3 space-y-2 pl-7"
      onclick={(e) => e.stopPropagation()}
      onkeydown={onConfirmKeydown}
    >
      <p id="{confirmId}-prompt" class="text-text-secondary text-sm">
        Delete this dose? This can't be undone.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          bind:this={cancelButton}
          onclick={closeConfirm}
          disabled={deleting}
          class="border-border-strong text-text-primary hover:bg-surface-overlay inline-flex min-h-8 items-center rounded-lg border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
        >
          Cancel
        </button>
        <form
          method="POST"
          action="?/deleteDose"
          use:enhance={() => {
            deleting = true;
            return async ({ result, update }) => {
              if (result.type === "success") showToast("Dose removed", "success");
              else if (result.type === "failure" || result.type === "error")
                showToast(actionErrorMessage(result), "error");
              // Taken now, before the update removes this row from the list.
              const neighbour = result.type === "success" ? neighbourRow() : undefined;
              await update();
              deleting = false;
              if (result.type === "success") {
                // The row has gone with the dose and taken the focused confirm
                // button with it. Left there, focus falls to <body> and a
                // keyboard user starts again from the top of the page, so hand
                // it to the row now in this one's place. The only row in its
                // list has no neighbour, and there focus stays where it fell.
                await tick();
                const active = document.activeElement;
                if (!active || active === document.body)
                  neighbour?.querySelector("button")?.focus();
              } else {
                // This attempt is over, so put focus back on × rather than
                // leave it on a button that was disabled underneath it.
                closeConfirm();
              }
            };
          }}
        >
          <input type="hidden" name="doseId" value={dose.id} />
          <!-- Not hover:opacity, the usual hover for a fill: it fades the label
               along with the fill, below 4.5:1 in dark mode, which is the
               defect this row has just shed. A ring changes neither. -->
          <button
            type="submit"
            class="bg-danger text-danger-fg hover:ring-danger-ink inline-flex min-h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium enabled:hover:ring-2 disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:min-h-11"
            aria-label="Confirm delete dose of {dose.medication.name} at {takenTime}"
            disabled={deleting}
          >
            {#if deleting}
              <span
                class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-middle"
                aria-hidden="true"
              ></span>
            {/if}
            Delete
          </button>
        </form>
      </div>
    </div>
  {/if}

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
