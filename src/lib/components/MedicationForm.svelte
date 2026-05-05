<script lang="ts">
  import { enhance } from "$app/forms";
  import { tick } from "svelte";
  import type { Medication } from "$lib/types";
  import type { MedicationSchedule } from "$lib/server/schedules";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";
  import MedicationIdentityFields from "./medication-form/MedicationIdentityFields.svelte";
  import MedicationDosageFields from "./medication-form/MedicationDosageFields.svelte";
  import MedicationCategoryFields from "./medication-form/MedicationCategoryFields.svelte";
  import MedicationStylePicker from "./medication-form/MedicationStylePicker.svelte";
  import MedicationScheduleSection from "./medication-form/MedicationScheduleSection.svelte";
  import MedicationInventoryFields from "./medication-form/MedicationInventoryFields.svelte";
  import {
    deriveInitialMode,
    deriveInitialFixedTimes,
    deriveInitialDaysOfWeek,
    type ScheduleMode,
  } from "$lib/medications/medication-form-state";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

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

  // Hidden-field derivations: the Zod schema validates these, so they
  // need to mirror the user's selection on every render.
  let schedulesJson = $derived.by(() => {
    if (scheduleMode === "prn") {
      return JSON.stringify([{ scheduleKind: "prn" }]);
    }
    if (scheduleMode === "interval") {
      const hrs = Number(intervalHours);
      return JSON.stringify([
        { scheduleKind: "interval", intervalHours: Number.isFinite(hrs) && hrs > 0 ? hrs : 0 },
      ]);
    }
    return JSON.stringify(
      fixedTimes
        .filter((t) => /^\d{2}:\d{2}$/.test(t))
        .map((t) => ({
          scheduleKind: "fixed_time",
          timeOfDay: t,
          daysOfWeek: daysOfWeek.length > 0 ? daysOfWeek : null,
        })),
    );
  });

  // Legacy compatibility shim — keep medications.scheduleType /
  // scheduleIntervalHours populated for one PR cycle so a rollback
  // still works against the new schedules table.
  let legacyScheduleType = $derived(scheduleMode === "prn" ? "as_needed" : "scheduled");
  let legacyIntervalHours = $derived(scheduleMode === "interval" ? intervalHours : "");

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
    return async ({ result, update }) => {
      await update();
      loading = false;
      if (result.type === "failure") {
        tick().then(() => {
          const firstInvalid = document.querySelector<HTMLElement>('[aria-invalid="true"]');
          firstInvalid?.focus();
        });
      }
    };
  }}
  class="space-y-5"
>
  <MedicationIdentityFields
    nameValue={formValues["name"] ?? medication?.name ?? ""}
    {errors}
    {interactionWarnings}
    onNameBlur={checkInteractions}
  />

  <MedicationDosageFields
    dosageAmount={formValues["dosageAmount"] ?? medication?.dosageAmount ?? ""}
    dosageUnit={formValues["dosageUnit"] ?? medication?.dosageUnit ?? ""}
    {errors}
  />

  <MedicationCategoryFields
    formValue={formValues["form"] ?? medication?.form ?? ""}
    categoryValue={formValues["category"] ?? medication?.category ?? ""}
    {errors}
  />

  <MedicationStylePicker
    bind:selectedColour
    bind:selectedColourSecondary
    bind:selectedPattern
    {errors}
  />

  <input type="hidden" name="colour" value={selectedColour} />
  <input type="hidden" name="colourSecondary" value={selectedColourSecondary ?? ""} />
  <input type="hidden" name="pattern" value={selectedPattern} />

  <MedicationScheduleSection
    bind:mode={scheduleMode}
    bind:intervalHours
    bind:fixedTimes
    bind:daysOfWeek
    {errors}
  />

  <input type="hidden" name="scheduleMode" value={scheduleMode} />
  <input type="hidden" name="schedules" value={schedulesJson} />
  <input type="hidden" name="scheduleType" value={legacyScheduleType} />
  <input type="hidden" name="scheduleIntervalHours" value={legacyIntervalHours} />

  <MedicationInventoryFields
    inventoryCount={formValues["inventoryCount"] ?? medication?.inventoryCount?.toString() ?? ""}
    inventoryAlertThreshold={formValues["inventoryAlertThreshold"] ??
      medication?.inventoryAlertThreshold?.toString() ??
      ""}
    notes={formValues["notes"] ?? medication?.notes ?? ""}
    {errors}
  />

  <MedicalDisclaimer variant="inline" />

  <button
    type="submit"
    disabled={loading}
    class="bg-accent text-accent-fg w-full rounded-lg px-4 py-2.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
  >
    {loading ? "Saving..." : medication ? "Update Medication" : "Add Medication"}
  </button>
</form>
