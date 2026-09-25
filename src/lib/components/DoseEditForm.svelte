<script lang="ts">
  import { enhance } from "$app/forms";
  import { tick } from "svelte";
  import { showToast } from "$components/ui/Toast.svelte";
  import SideEffectPicker from "$components/SideEffectPicker.svelte";
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
  let loading = $state(false);
  let sideEffects = $state<SideEffect[]>(dose.sideEffects ?? []);
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
</script>

<form
  method="POST"
  action="?/editDose"
  use:enhance={() => {
    loading = true;
    return async ({ formElement, result, update }) => {
      loading = false;
      fieldErrors = actionFieldErrors(result);
      formError = "";
      if (result.type === "success") {
        showToast("Dose updated", "success");
        onclose();
      } else if (result.type === "failure" || result.type === "error") {
        const message = unsavedErrorMessage(result, "Couldn't update dose. Please try again.");
        showToast(message, "error");
        const besideAField = INLINE_FIELDS.some((field) => fieldErrors[field]);
        formError = fieldErrors.form ?? (besideAField ? "" : message);
        // `update()` hands an error result to the nearest +error.svelte, which
        // replaces the whole page: the modal and the edit in it are thrown
        // away, and nothing says the dose was not saved. An expired session
        // or a crash is better answered here, with the edit still open to
        // retry or cancel.
        if (result.type === "error") {
          await focusFirstProblem(formElement);
          return;
        }
      }
      await update();
      if (result.type === "failure") await focusFirstProblem(formElement);
    };
  }}
  class="space-y-4"
>
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
    <p class="bg-danger/10 text-danger-ink rounded-lg px-4 py-2 text-sm" role="alert" tabindex="-1">
      {formError}
    </p>
  {/if}

  <div class="flex gap-3">
    <button
      type="button"
      onclick={onclose}
      class="border-glass-border hover:bg-surface-overlay flex-1 rounded-lg border py-2.5 text-sm font-medium transition-colors"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={loading}
      class="bg-accent text-accent-fg flex-1 rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {loading ? "Saving..." : "Save Changes"}
    </button>
  </div>
</form>
