<script lang="ts">
  import { applyAction, enhance } from "$app/forms";
  import { tick, untrack } from "svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { showToast } from "$components/ui/Toast.svelte";
  import SideEffectPicker from "$components/SideEffectPicker.svelte";
  import Alert from "$components/ui/Alert.svelte";
  import Button from "$components/ui/Button.svelte";
  import { beginDoseWrite } from "$components/dose-writes/begin-dose-write";
  import { getDoseWriteLock } from "$components/dose-writes/dose-write-lock.svelte";
  import { UNKNOWN_OUTCOME_TOAST } from "$components/dose-writes/copy";
  import { reloadAfterWrite } from "$components/dose-writes/reload-after-write";
  import {
    clearUndo,
    watchSession,
    withdrawUndoFor,
  } from "$components/dose-writes/undo-registry.svelte";
  import { formatDateTimeLocal } from "$lib/utils/time";
  import { actionFieldErrors, unsavedErrorMessage } from "$lib/utils/form-errors";
  import type { DoseLogWithMedication, SideEffect } from "$lib/types";

  // `timezone` is the user's PROFILE zone and is not optional: the server
  // parses this field back with `parseDateTimeLocal(takenAt, user.timezone)`,
  // so rendering it in the browser's zone instead silently shifted the
  // timestamp on every save for anyone whose device zone differs.
  let {
    dose,
    timezone,
    onclose,
  }: { dose: DoseLogWithMedication; timezone: string; onclose: () => void } = $props();

  // The (app) layout's dose-write lock. Save keeps its own enhance for the
  // inline field errors below, but it is a dose write like any other: it
  // starts through the same gate (`beginDoseWrite`), so Save and the dialog's
  // Remove exclude each other, and a Save cannot start while another dose
  // write is still in flight.
  const lock = getDoseWriteLock();

  let loading = $state(false);
  // Seeded once from the dose this form opened on. `untrack` says so: the
  // picker owns the value from here on, and a later `dose` must not reset it.
  let sideEffects = $state<SideEffect[]>(untrack(() => dose.sideEffects ?? []));
  // The action's per-field messages, shown beside their controls. The toast
  // names one problem and then disappears; a rejected date and quantity
  // together need both to stay put next to the fields that caused them.
  let fieldErrors = $state<Record<string, string>>({});
  // Everything with no field of its own to sit beside: a dose deleted in
  // another tab, an expired session, a crash and its reference. The toast is
  // not enough on its own. It lives in the (app) layout, outside this
  // aria-modal dialog, so a screen reader is not told about it while the
  // dialog is open; and it closes after five seconds, taking the reference
  // support would ask for with it.
  let formError = $state("");

  // The keys with a message slot in this form. Any other keyed failure (the
  // hidden doseId, say) has nowhere to go but `formError`.
  const INLINE_FIELDS = ["takenAt", "quantity", "notes", "sideEffects"];

  /**
   * Put focus on the first thing that went wrong, inside this form: the
   * first invalid control, otherwise the first message. It moves on every
   * failed save, even one identical to the last, because a message that
   * does not change is not announced again, and landing on the field
   * re-reads its label and its description.
   */
  async function focusFirstProblem(form: HTMLFormElement) {
    await tick();
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[role="alert"]');
    target?.focus();
  }

  /**
   * Nothing here calls enhance's `update()`. On success its `reset_focus`
   * sent focus to <body> after the Modal had returned it to the Edit button;
   * on an error result it handed the page to +error.svelte and threw the
   * edit away. Reloads go through `reloadAfterWrite()` instead.
   *
   * A result that lands after the (app) layout has gone (a sign-out) shows
   * nothing and only lets go of the lock, as createDoseWrite's does: on a
   * shared device it would otherwise speak to the next person.
   */
  const save: SubmitFunction = ({ cancel }) => {
    // The gate every dose write passes: offline, then the lock. A refusal has
    // already cancelled and, unless only the cooldown refused it, told the
    // user.
    if (!beginDoseWrite(cancel, lock)) return;
    const sessionEnded = watchSession();
    // Only once the Save is certain to be sent, so a refused Save never costs
    // the user their Undo. An offer naming this dose would otherwise act on
    // the row as it was before the edit.
    withdrawUndoFor(dose.id);
    loading = true;

    return async ({ formElement, result }) => {
      try {
        // Signed out while the request was in flight: show nothing.
        if (sessionEnded()) return;
        loading = false;
        fieldErrors = actionFieldErrors(result);
        formError = "";
        if (result.type === "success") {
          // An edit can move a dose onto a deleted one's slot, so no older
          // Undo survives it, whichever dose it names.
          clearUndo();
          showToast("Dose updated", "success");
          onclose();
          await reloadAfterWrite({ cancelled: sessionEnded });
        } else if (result.type === "redirect") {
          await applyAction(result);
        } else if (result.type === "error" && result.status === undefined) {
          // No response at all: the edit may or may not have landed. Say so
          // inside the dialog too, where a screen reader can hear it, then
          // keep the lock until the server answers and the page has reloaded,
          // so a retry acts on data somebody has checked.
          showToast(UNKNOWN_OUTCOME_TOAST, "error");
          formError = UNKNOWN_OUTCOME_TOAST;
          await focusFirstProblem(formElement);
          // `cancelled`: a sign-out while it waits stops the probing, and
          // nothing is reloaded.
          await reloadAfterWrite({ waitForServer: true, cancelled: sessionEnded });
        } else {
          const message = unsavedErrorMessage(result, "Couldn't update dose. Please try again.");
          showToast(message, "error");
          const besideAField = INLINE_FIELDS.some((field) => fieldErrors[field]);
          formError = fieldErrors.form ?? (besideAField ? "" : message);
          await focusFirstProblem(formElement);
          // A refusal (a dose deleted in another tab, a rejected field)
          // reloads, so the list behind the dialog stops showing a dose that
          // is gone. An expired session or a crash does not: the edit stays
          // open, unchanged, to retry or cancel.
          if (result.type === "failure") await reloadAfterWrite({ cancelled: sessionEnded });
        }
      } finally {
        loading = false;
        lock.release();
      }
    };
  };
</script>

<form method="POST" action="?/editDose" use:enhance={save} class="space-y-4">
  <input type="hidden" name="doseId" value={dose.id} />
  <!-- The instant this form rendered. On a fall-back day two different
       instants render as the same wall clock, so without this a Save that
       changed nothing would rewrite takenAt an hour earlier. -->
  <input type="hidden" name="originalTakenAt" value={new Date(dose.takenAt).toISOString()} />

  <div class="mb-2 flex items-center gap-3">
    <div class="h-4 w-4 rounded-full" style="background-color: {dose.medication.colour}"></div>
    <h3 class="text-lg font-semibold">{dose.medication.name}</h3>
    <span class="text-text-secondary text-sm"
      >{dose.medication.dosageAmount}{dose.medication.dosageUnit}</span
    >
  </div>

  <div>
    <label for="takenAt" class="mb-1 block text-sm font-medium">Time Taken</label>
    <input
      id="takenAt"
      name="takenAt"
      type="datetime-local"
      value={formatDateTimeLocal(new Date(dose.takenAt), timezone)}
      aria-invalid={fieldErrors.takenAt ? "true" : undefined}
      aria-describedby={fieldErrors.takenAt ? "takenAt-error" : undefined}
      class="border-border-strong bg-surface text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if fieldErrors.takenAt}
      <p id="takenAt-error" class="text-danger-ink mt-1 text-sm" role="alert">
        {fieldErrors.takenAt}
      </p>
    {/if}
  </div>

  <div>
    <label for="quantity" class="mb-1 block text-sm font-medium">Quantity</label>
    <input
      id="quantity"
      name="quantity"
      type="number"
      min="1"
      max="10"
      value={dose.quantity}
      aria-invalid={fieldErrors.quantity ? "true" : undefined}
      aria-describedby={fieldErrors.quantity ? "quantity-error" : undefined}
      class="border-border-strong bg-surface text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if fieldErrors.quantity}
      <p id="quantity-error" class="text-danger-ink mt-1 text-sm" role="alert">
        {fieldErrors.quantity}
      </p>
    {/if}
  </div>

  <div>
    <label for="notes" class="mb-1 block text-sm font-medium">Notes</label>
    <textarea
      id="notes"
      name="notes"
      rows="2"
      aria-invalid={fieldErrors.notes ? "true" : undefined}
      aria-describedby={fieldErrors.notes ? "notes-error" : undefined}
      class="border-border-strong bg-surface text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
      placeholder="Optional notes...">{dose.notes ?? ""}</textarea
    >
    {#if fieldErrors.notes}
      <p id="notes-error" class="text-danger-ink mt-1 text-sm" role="alert">
        {fieldErrors.notes}
      </p>
    {/if}
  </div>

  <!-- The picker is a group of toggles with no single control to carry
       aria-invalid, so its message is shown beside it and announced, and the
       group is described by it for anyone who tabs back into the chips.
       tabindex="-1" lets a failed save put focus on the message itself. -->
  <div
    role="group"
    aria-label="Side effects"
    aria-describedby={fieldErrors.sideEffects ? "sideEffects-error" : undefined}
  >
    <SideEffectPicker value={sideEffects} onchange={(effects) => (sideEffects = effects)} />
  </div>
  {#if fieldErrors.sideEffects}
    <p id="sideEffects-error" class="text-danger-ink -mt-2 text-sm" role="alert" tabindex="-1">
      {fieldErrors.sideEffects}
    </p>
  {/if}
  <input
    type="hidden"
    name="sideEffects"
    value={sideEffects.length > 0 ? JSON.stringify(sideEffects) : ""}
  />

  <!-- Inside the form, and so inside the dialog, where a screen reader can
       reach it. It stays until the next result so a crash's reference can be
       read and copied; tabindex="-1" takes focus without joining the Tab
       order, and the modal's trap still wraps from it. -->
  {#if formError}
    <Alert tone="wrong" title={formError} tabindex={-1} />
  {/if}

  <div class="flex gap-3">
    <Button variant="ghost" class="flex-1" onclick={onclose}>Cancel</Button>
    <!-- aria-disabled, never `disabled`: the attribute drops keyboard focus
         to <body>. A busy Save is cancelled in `save` instead. min-h-11 is
         the dose-control floor; compact density rewrites .py-2.5. -->
    <button
      type="submit"
      aria-disabled={loading || lock.busy ? "true" : undefined}
      class="bg-accent text-accent-fg min-h-11 flex-1 rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    >
      {loading ? "Saving..." : "Save Changes"}
    </button>
  </div>
</form>
