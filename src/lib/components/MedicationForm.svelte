<script lang="ts">
  import { enhance } from "$app/forms";
  import { tick } from "svelte";
  import type { Medication } from "$lib/types";
  import type { MedicationSchedule } from "$lib/server/schedules";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import MedicationIdentityFields from "./medication-form/MedicationIdentityFields.svelte";
  import MedicationDosageFields from "./medication-form/MedicationDosageFields.svelte";
  import MedicationCategoryFields from "./medication-form/MedicationCategoryFields.svelte";
  import MedicationStylePicker from "./medication-form/MedicationStylePicker.svelte";
  import MedicationScheduleSection from "./medication-form/MedicationScheduleSection.svelte";
  import MedicationInventoryFields from "./medication-form/MedicationInventoryFields.svelte";
  import MedicationNotificationFields from "./medication-form/MedicationNotificationFields.svelte";
  import {
    deriveInitialMode,
    deriveInitialFixedTimes,
    deriveInitialDaysOfWeek,
    deriveNotificationValue,
    describeStoredSchedule,
    isRepresentableByForm,
    serialiseFormSchedules,
    storedScheduleAsPosted,
    type ScheduleMode,
  } from "$lib/medications/medication-form-state";
  import type { FormErrors } from "$lib/medications/medication-form-errors";
  import { unsavedErrorMessage } from "$lib/utils/form-errors";

  let {
    medication = undefined,
    schedules = [],
    errors = {} as FormErrors,
    formValues = {} as Record<string, string>,
  }: {
    medication?: Medication;
    schedules?: MedicationSchedule[];
    errors?: FormErrors;
    formValues?: Record<string, string>;
  } = $props();

  // Style state — bound to MedicationStylePicker.
  let selectedColour = $state(formValues["colour"] ?? medication?.colour ?? "#6366f1");
  let selectedColourSecondary = $state<string | null>(
    formValues["colourSecondary"] ?? medication?.colourSecondary ?? null,
  );
  let selectedPattern = $state(formValues["pattern"] ?? medication?.pattern ?? "solid");

  // Schedule state — bound to MedicationScheduleSection.
  let scheduleMode = $state<ScheduleMode>(
    deriveInitialMode({
      formValueMode: formValues["scheduleMode"],
      schedules,
      medication,
    }),
  );
  let intervalHours = $state(
    formValues["scheduleIntervalHours"] ??
      schedules.find((s) => s.scheduleKind === "interval")?.intervalHours ??
      medication?.scheduleIntervalHours ??
      "",
  );
  let fixedTimes = $state<string[]>(deriveInitialFixedTimes(schedules));
  let daysOfWeek = $state<number[]>(deriveInitialDaysOfWeek(schedules));

  let loading = $state(false);
  // An unexpected throw or an expired session. Field failures arrive through
  // the `errors` prop, but an error result carries no `form` for the page to
  // hand back, so this is the only place it can be said.
  let actionError = $state("");
  // The crash message's id, so the after-callback can find it inside the form
  // and hand it focus.
  const ACTION_ERROR_ID = "medication-form-error";
  // The `errors` prop only changes when `update()` runs, which an error
  // result skips, so the previous attempt's field messages would otherwise
  // stay marked invalid beside a message saying nothing was checked at all.
  let shownErrors = $derived<FormErrors>(actionError ? {} : errors);

  // A schedule stored through /api/v1 or an import can be a shape this form
  // does not model: fixed times on different days, or interval and fixed rows
  // together. Seeding the editor from it and saving would rewrite it (every
  // fixed row given the first row's days, interval rows dropped), so it is
  // shown read-only and posted back exactly as stored, and the rest of the
  // form stays editable. A schedule the form CAN represent is edited as before.
  let lockedSchedules = $derived(
    medication && !isRepresentableByForm(schedules) ? schedules : null,
  );

  // Hidden-field derivations: the Zod schema validates these, so they
  // need to mirror the user's selection on every render.
  let schedulesJson = $derived(
    JSON.stringify(
      lockedSchedules
        ? lockedSchedules.map(storedScheduleAsPosted)
        : serialiseFormSchedules({ mode: scheduleMode, intervalHours, fixedTimes, daysOfWeek }),
    ),
  );

  // Legacy compatibility shim — keep medications.scheduleType /
  // scheduleIntervalHours populated for one PR cycle so a rollback
  // still works against the new schedules table. A locked schedule keeps
  // the legacy columns it already has.
  let legacyScheduleType = $derived(
    lockedSchedules && medication
      ? medication.scheduleType
      : scheduleMode === "prn"
        ? "as_needed"
        : "scheduled",
  );
  let legacyIntervalHours = $derived(
    lockedSchedules && medication
      ? (medication.scheduleIntervalHours ?? "")
      : scheduleMode === "interval"
        ? intervalHours
        : "",
  );

  // Drug-interaction probe. Debounced, gated on a saved-medication
  // edit (we don't run it for `medication !== undefined` because the
  // user opened an existing record, not a fresh add).
  let interactionWarnings = $state<string[]>([]);
  let interactionTimer: ReturnType<typeof setTimeout> | undefined;

  function checkInteractions(name: string) {
    clearTimeout(interactionTimer);
    if (!name || name.length < 2 || medication) {
      interactionWarnings = [];
      return;
    }
    interactionTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/interactions?drug=${encodeURIComponent(name)}`);
        if (res.ok) {
          const data = await res.json();
          interactionWarnings = data.warnings ?? [];
        }
      } catch {
        interactionWarnings = [];
      }
    }, 500);
  }
</script>

<form
  method="POST"
  action={medication ? "?/update" : undefined}
  use:enhance={() => {
    loading = true;
    return async ({ formElement, result, update }) => {
      if (result.type === "error") {
        // `update()` would hand this to the nearest +error.svelte, which
        // replaces the page and every field the user has filled in. Say what
        // happened here instead, with the reference `handleError` minted, and
        // leave the form intact to retry.
        loading = false;
        actionError = unsavedErrorMessage(result);
        await tick();
        formElement.querySelector<HTMLElement>(`#${ACTION_ERROR_ID}`)?.focus();
        return;
      }
      actionError = "";
      await update();
      loading = false;
      if (result.type === "failure") {
        tick().then(() => {
          // aria-invalid is only emitted by fields that ARE a single control.
          // Group-level failures (schedules, colour) have nowhere to put it, and
          // querying for it alone meant those failures moved focus nowhere and
          // announced nothing — the page looked like it had ignored the submit.
          // Falling back to the first alert covers them; it needs tabindex to be
          // focusable, since a <p> is not.
          //
          // Scoped to this form, as DoseEditForm's `focusFirstProblem` is. A
          // page-wide query took the first alert on the page, which was the
          // interaction notice, not this form's message.
          const invalid = formElement.querySelector<HTMLElement>('[aria-invalid="true"]');
          const target = invalid ?? formElement.querySelector<HTMLElement>('[role="alert"]');
          if (!target) return;
          if (!invalid) target.setAttribute("tabindex", "-1");
          target.focus();
        });
      }
    };
  }}
  class="space-y-5"
>
  <MedicationIdentityFields
    nameValue={formValues["name"] ?? medication?.name ?? ""}
    errors={shownErrors}
    {interactionWarnings}
    onNameBlur={checkInteractions}
  />

  <MedicationDosageFields
    dosageAmount={formValues["dosageAmount"] ?? medication?.dosageAmount ?? ""}
    dosageUnit={formValues["dosageUnit"] ?? medication?.dosageUnit ?? ""}
    errors={shownErrors}
  />

  <MedicationCategoryFields
    formValue={formValues["form"] ?? medication?.form ?? ""}
    categoryValue={formValues["category"] ?? medication?.category ?? ""}
    errors={shownErrors}
  />

  <MedicationStylePicker
    bind:selectedColour
    bind:selectedColourSecondary
    bind:selectedPattern
    errors={shownErrors}
  />

  <input type="hidden" name="colour" value={selectedColour} />
  <input type="hidden" name="colourSecondary" value={selectedColourSecondary ?? ""} />
  <input type="hidden" name="pattern" value={selectedPattern} />

  {#if lockedSchedules}
    <div data-locked-schedule>
      <span class="mb-1 block text-sm font-medium">Schedule</span>
      <ul class="text-text-primary mb-2 space-y-1 text-sm">
        {#each lockedSchedules as row, idx (idx)}
          <li>{describeStoredSchedule(row)}</li>
        {/each}
      </ul>
      <Alert tone="neutral" title="This schedule is managed elsewhere">
        It was set up in the Mac app or by an import, and this form can't edit it without changing
        it. Saving keeps it exactly as it is.
      </Alert>
      {#if shownErrors["schedules"]?.[0]}<p
          id="schedules-error"
          class="text-danger-ink mt-1 text-sm"
          role="alert"
        >
          {shownErrors["schedules"][0]}
        </p>{/if}
    </div>
  {:else}
    <MedicationScheduleSection
      bind:mode={scheduleMode}
      bind:intervalHours
      bind:fixedTimes
      bind:daysOfWeek
      errors={shownErrors}
    />
  {/if}

  <input type="hidden" name="scheduleMode" value={scheduleMode} />
  <input type="hidden" name="schedules" value={schedulesJson} />
  <input type="hidden" name="scheduleType" value={legacyScheduleType} />
  <input type="hidden" name="scheduleIntervalHours" value={legacyIntervalHours} />

  <MedicationNotificationFields
    notificationsEnabled={formValues["notificationsEnabled"] !== undefined
      ? formValues["notificationsEnabled"] === "on"
      : (medication?.notificationsEnabled ?? true)}
    overdueEmail={deriveNotificationValue(
      formValues["notifyOverdueEmail"],
      medication?.notifyOverdueEmail,
    )}
    overduePush={deriveNotificationValue(
      formValues["notifyOverduePush"],
      medication?.notifyOverduePush,
    )}
    lowInventoryEmail={deriveNotificationValue(
      formValues["notifyLowInventoryEmail"],
      medication?.notifyLowInventoryEmail,
    )}
    lowInventoryPush={deriveNotificationValue(
      formValues["notifyLowInventoryPush"],
      medication?.notifyLowInventoryPush,
    )}
    offsetMinutes={formValues["notifyOffsetMinutes"] ??
      medication?.notifyOffsetMinutes?.toString() ??
      "0"}
    repeatEveryMinutes={formValues["notifyRepeatEveryMinutes"] ??
      medication?.notifyRepeatEveryMinutes?.toString() ??
      ""}
    maxRepeats={formValues["notifyMaxRepeats"] ?? medication?.notifyMaxRepeats?.toString() ?? "3"}
    errors={shownErrors}
  />

  <MedicationInventoryFields
    inventoryCount={formValues["inventoryCount"] ?? medication?.inventoryCount?.toString() ?? ""}
    inventoryAlertThreshold={formValues["inventoryAlertThreshold"] ??
      medication?.inventoryAlertThreshold?.toString() ??
      ""}
    notes={formValues["notes"] ?? medication?.notes ?? ""}
    errors={shownErrors}
  />

  <MedicalDisclaimer variant="inline" />

  {#if actionError}
    <Alert tone="wrong" id={ACTION_ERROR_ID} title={actionError} tabindex={-1} />
  {/if}

  <Button variant="primary" type="submit" block disabled={loading} pending={loading}>
    {medication ? "Update Medication" : "Add Medication"}
  </Button>
</form>
