<script lang="ts">
  import { enhance } from "$app/forms";
  import { tick } from "svelte";
  import type { Medication } from "$lib/types";
  import type { MedicationSchedule } from "$lib/server/schedules";
  import Input from "$lib/components/ui/Input.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";
  import {
    getMedicationBackground,
    getReadableTextColor,
    PATTERN_OPTIONS,
  } from "$lib/utils/medication-style";

  type ScheduleMode = "interval" | "fixed_time" | "prn";
  const SCHEDULE_MODES = new Set<ScheduleMode>(["interval", "fixed_time", "prn"]);

  function isScheduleMode(v: unknown): v is ScheduleMode {
    return typeof v === "string" && SCHEDULE_MODES.has(v as ScheduleMode);
  }

  let {
    medication = undefined,
    schedules = [],
    errors = {},
    formValues = {},
  }: {
    medication?: Medication;
    schedules?: MedicationSchedule[];
    errors?: Record<string, string[]>;
    formValues?: Record<string, string>;
  } = $props();

  function deriveInitialMode(): ScheduleMode {
    if (isScheduleMode(formValues["scheduleMode"])) return formValues["scheduleMode"];
    if (schedules.length > 0) {
      const kinds = new Set(schedules.map((s) => s.scheduleKind));
      if (kinds.size === 1) {
        const only = [...kinds][0];
        if (only === "fixed_time") return "fixed_time";
        if (only === "prn") return "prn";
        return "interval";
      }
      // Mixed kinds — keep the editor in fixed_time (most flexible).
      return "fixed_time";
    }
    if (medication?.scheduleType === "as_needed") return "prn";
    return "interval";
  }

  function deriveInitialTimes(): string[] {
    const fixed = schedules.filter((s) => s.scheduleKind === "fixed_time" && s.timeOfDay);
    if (fixed.length > 0) return fixed.map((s) => s.timeOfDay!);
    return ["08:00"];
  }

  function deriveInitialDaysOfWeek(): number[] {
    const fixed = schedules.find((s) => s.scheduleKind === "fixed_time" && s.daysOfWeek);
    return (fixed?.daysOfWeek ?? []) as number[];
  }

  const presetColours = [
    "#6366f1",
    "#8b5cf6",
    "#a855f7",
    "#ec4899",
    "#f43f5e",
    "#ef4444",
    "#f97316",
    "#f59e0b",
    "#84cc16",
    "#10b981",
    "#14b8a6",
    "#06b6d4",
    "#0ea5e9",
    "#3b82f6",
    "#64748b",
    "#ffffff",
  ];

  let selectedColour = $state(formValues["colour"] ?? medication?.colour ?? "#6366f1");

  let selectedColourSecondary = $state<string | null>(
    formValues["colourSecondary"] ?? medication?.colourSecondary ?? null,
  );
  let showSecondary = $state(selectedColourSecondary !== null);
  let selectedPattern = $state(formValues["pattern"] ?? medication?.pattern ?? "solid");
  const sampleFg = $derived(getReadableTextColor(selectedColour, selectedColourSecondary));

  let loading = $state(false);
  let scheduleMode = $state<ScheduleMode>(deriveInitialMode());
  let intervalHours = $state(
    formValues["scheduleIntervalHours"] ??
      schedules.find((s) => s.scheduleKind === "interval")?.intervalHours ??
      medication?.scheduleIntervalHours ??
      "",
  );
  let fixedTimes = $state<string[]>(deriveInitialTimes());
  let daysOfWeek = $state<number[]>(deriveInitialDaysOfWeek());

  const DAY_LABELS: { value: number; short: string }[] = [
    { value: 1, short: "Mon" },
    { value: 2, short: "Tue" },
    { value: 3, short: "Wed" },
    { value: 4, short: "Thu" },
    { value: 5, short: "Fri" },
    { value: 6, short: "Sat" },
    { value: 0, short: "Sun" },
  ];

  function toggleDay(d: number) {
    if (daysOfWeek.includes(d)) {
      daysOfWeek = daysOfWeek.filter((x) => x !== d);
    } else {
      daysOfWeek = [...daysOfWeek, d].sort((a, b) => a - b);
    }
  }

  function addFixedTime() {
    fixedTimes = [...fixedTimes, "12:00"];
  }

  function removeFixedTime(idx: number) {
    fixedTimes = fixedTimes.filter((_, i) => i !== idx);
    if (fixedTimes.length === 0) fixedTimes = ["08:00"];
  }

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

  const formOptions = [
    { value: "tablet", label: "Tablet" },
    { value: "capsule", label: "Capsule" },
    { value: "liquid", label: "Liquid" },
    { value: "softgel", label: "Softgel" },
    { value: "patch", label: "Patch" },
    { value: "injection", label: "Injection" },
    { value: "inhaler", label: "Inhaler" },
    { value: "drops", label: "Drops" },
    { value: "cream", label: "Cream" },
    { value: "other", label: "Other" },
  ];

  const categoryOptions = [
    { value: "prescription", label: "Prescription" },
    { value: "otc", label: "Over the Counter" },
    { value: "supplement", label: "Supplement" },
  ];

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
  <Input
    label="Name"
    name="name"
    value={formValues["name"] ?? medication?.name ?? ""}
    error={errors["name"]?.[0] ?? ""}
    required
    placeholder="e.g. Aspirin"
    onblur={(e: FocusEvent & { currentTarget: HTMLInputElement }) =>
      checkInteractions(e.currentTarget.value)}
  />

  {#if interactionWarnings.length > 0}
    <div class="border-warning/30 bg-warning/5 rounded-lg border px-4 py-3" role="alert">
      <p class="text-warning mb-1 text-xs font-medium tracking-wider uppercase">
        Experimental interaction notice
      </p>
      {#each interactionWarnings as warning}
        <p class="text-text-secondary text-sm">{warning}</p>
      {/each}
      <p class="text-text-muted mt-2 text-xs">
        This check may miss interactions and may produce false positives. It is not a substitute for
        professional medical advice.
      </p>
    </div>
  {/if}

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Input
      label="Dosage Amount"
      name="dosageAmount"
      value={formValues["dosageAmount"] ?? medication?.dosageAmount ?? ""}
      error={errors["dosageAmount"]?.[0] ?? ""}
      required
      placeholder="e.g. 500"
    />
    <Input
      label="Dosage Unit"
      name="dosageUnit"
      value={formValues["dosageUnit"] ?? medication?.dosageUnit ?? ""}
      error={errors["dosageUnit"]?.[0] ?? ""}
      required
      placeholder="e.g. mg"
    />
  </div>

  <div>
    <label for="form" class="mb-1 block text-sm font-medium">Form</label>
    <select
      id="form"
      name="form"
      class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >
      {#each formOptions as opt}
        <option value={opt.value} selected={(formValues["form"] ?? medication?.form) === opt.value}
          >{opt.label}</option
        >
      {/each}
    </select>
    {#if errors["form"]?.[0]}<p class="text-danger mt-1 text-sm">{errors["form"][0]}</p>{/if}
  </div>

  <div>
    <label for="category" class="mb-1 block text-sm font-medium">Category</label>
    <select
      id="category"
      name="category"
      class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    >
      {#each categoryOptions as opt}
        <option
          value={opt.value}
          selected={(formValues["category"] ?? medication?.category) === opt.value}
          >{opt.label}</option
        >
      {/each}
    </select>
    {#if errors["category"]?.[0]}<p class="text-danger mt-1 text-sm">
        {errors["category"][0]}
      </p>{/if}
  </div>

  <fieldset class="m-0 space-y-0 border-0 p-0">
    <legend class="mb-2 block text-sm font-medium">
      Colour & Pattern
      <Tooltip
        text="Choose how this medication appears across the app — on cards, pills, and timeline entries."
      />
    </legend>

    <!-- Primary colour row -->
    <div class="mb-2">
      {#if showSecondary}<span class="text-text-muted mb-1 block text-xs">Primary</span>{/if}
      <div class="flex flex-wrap items-center gap-2">
        {#each presetColours as colour}
          <button
            type="button"
            onclick={() => (selectedColour = colour)}
            class="focus:ring-accent h-8 w-8 rounded-full transition-transform hover:scale-110 focus:ring-2 focus:ring-offset-2 focus:outline-none {selectedColour ===
            colour
              ? 'ring-accent scale-110 ring-2 ring-offset-2'
              : ''}"
            style="background-color: {colour}"
            aria-label="Select primary colour {colour}"
          ></button>
        {/each}
        {#if !showSecondary}
          <button
            type="button"
            onclick={() => {
              showSecondary = true;
              selectedColourSecondary = presetColours[2];
            }}
            class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-white/30 text-lg text-white/40 transition-colors hover:border-white/50 hover:text-white/60"
            aria-label="Add secondary colour">+</button
          >
        {/if}
      </div>
    </div>

    <!-- Secondary colour row (visible when + clicked) -->
    {#if showSecondary}
      <div class="mb-3">
        <span class="text-text-muted mb-1 block text-xs">Secondary</span>
        <div class="flex flex-wrap items-center gap-2">
          {#each presetColours as colour}
            <button
              type="button"
              onclick={() => (selectedColourSecondary = colour)}
              class="focus:ring-accent h-8 w-8 rounded-full transition-transform hover:scale-110 focus:ring-2 focus:ring-offset-2 focus:outline-none {selectedColourSecondary ===
              colour
                ? 'ring-accent scale-110 ring-2 ring-offset-2'
                : ''}"
              style="background-color: {colour}"
              aria-label="Select secondary colour {colour}"
            ></button>
          {/each}
          <button
            type="button"
            onclick={() => {
              showSecondary = false;
              selectedColourSecondary = null;
              selectedPattern = "solid";
            }}
            class="border-danger/50 text-danger/70 hover:border-danger hover:text-danger flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed text-sm transition-colors"
            aria-label="Remove secondary colour">&times;</button
          >
        </div>
      </div>

      <!-- Pattern grid -->
      <div class="mb-3">
        <span class="text-text-muted mb-1 block text-xs">Pattern</span>
        <div class="flex flex-wrap gap-2">
          {#each PATTERN_OPTIONS as pat}
            <button
              type="button"
              onclick={() => (selectedPattern = pat.id)}
              class="h-11 w-11 rounded-lg border-2 transition-transform hover:scale-105 {selectedPattern ===
              pat.id
                ? 'scale-105 border-white'
                : 'border-transparent'}"
              style="background: {getMedicationBackground(
                selectedColour,
                selectedColourSecondary,
                pat.id,
              )}"
              aria-label="Select {pat.name} pattern"
              title={pat.name}
            ></button>
          {/each}
        </div>
      </div>

      <!-- Live preview -->
      <div class="flex items-center gap-3">
        <span class="text-text-muted text-xs">Preview</span>
        <div
          class="h-10 w-10 rounded-lg"
          style="background: {getMedicationBackground(
            selectedColour,
            selectedColourSecondary,
            selectedPattern,
          )}"
        ></div>
        <div
          class="h-3 w-3 rounded-full"
          style="background: {getMedicationBackground(
            selectedColour,
            selectedColourSecondary,
            selectedPattern,
            true,
          )}"
        ></div>
        <div
          class="flex h-8 items-center rounded-full px-4 text-xs font-medium"
          style="background: {getMedicationBackground(
            selectedColour,
            selectedColourSecondary,
            selectedPattern,
          )}; color: {sampleFg.color}; text-shadow: {sampleFg.textShadow};"
        >
          Sample Pill
        </div>
      </div>
    {/if}

    <input type="hidden" name="colour" value={selectedColour} />
    <input type="hidden" name="colourSecondary" value={selectedColourSecondary ?? ""} />
    <input type="hidden" name="pattern" value={selectedPattern} />
    {#if errors["colour"]?.[0]}<p class="text-danger mt-1 text-sm">{errors["colour"][0]}</p>{/if}
  </fieldset>

  <div>
    <label class="mb-1 block text-sm font-medium">
      Schedule
      <Tooltip
        text="Interval: every N hours. Fixed time: at one or more specific times of day. As needed (PRN): only when required, no reminders."
      />
    </label>
    <div class="flex gap-2">
      <button
        type="button"
        onclick={() => (scheduleMode = "interval")}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleMode ===
        'interval'
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        Interval
      </button>
      <button
        type="button"
        onclick={() => (scheduleMode = "fixed_time")}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleMode ===
        'fixed_time'
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        Fixed time
      </button>
      <button
        type="button"
        onclick={() => (scheduleMode = "prn")}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleMode ===
        'prn'
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        As needed (PRN)
      </button>
    </div>
  </div>

  {#if scheduleMode === "interval"}
    <div>
      <label for="intervalHours" class="mb-1 block text-sm font-medium">
        Every N hours
        <Tooltip
          text="How many hours between doses. Used to calculate adherence and send overdue reminders."
        />
      </label>
      <input
        id="intervalHours"
        type="number"
        bind:value={intervalHours}
        placeholder="e.g. 8"
        min="0.5"
        max="72"
        step="0.5"
        class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
      />
      {#if errors["schedules"]?.[0]}<p class="text-danger mt-1 text-sm">
          {errors["schedules"][0]}
        </p>{/if}
    </div>
  {:else if scheduleMode === "fixed_time"}
    <div class="space-y-3">
      <div>
        <span class="mb-1 block text-sm font-medium">
          Times of day
          <Tooltip
            text="One slot per scheduled time. Add multiple rows for twice-daily, three-times-daily, etc."
          />
        </span>
        <div class="space-y-2">
          {#each fixedTimes as _time, idx (idx)}
            <div class="flex items-center gap-2">
              <input
                type="time"
                bind:value={fixedTimes[idx]}
                class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent flex-1 rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
                aria-label="Time of day {idx + 1}"
              />
              <button
                type="button"
                onclick={() => removeFixedTime(idx)}
                disabled={fixedTimes.length <= 1}
                class="border-glass-border text-text-secondary hover:text-danger hover:border-danger rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Remove this time"
              >
                Remove
              </button>
            </div>
          {/each}
        </div>
        <button
          type="button"
          onclick={addFixedTime}
          class="border-glass-border text-text-secondary hover:bg-glass-hover mt-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
        >
          + Add time
        </button>
      </div>

      <div>
        <span class="mb-1 block text-sm font-medium">
          Days of the week
          <Tooltip
            text="Leave empty to apply every day. Select specific days (e.g. weekdays only) to restrict."
          />
        </span>
        <div class="flex flex-wrap gap-2">
          {#each DAY_LABELS as { value, short }}
            <button
              type="button"
              onclick={() => toggleDay(value)}
              aria-pressed={daysOfWeek.includes(value)}
              class="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors {daysOfWeek.includes(
                value,
              )
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
            >
              {short}
            </button>
          {/each}
        </div>
      </div>
      {#if errors["schedules"]?.[0]}<p class="text-danger mt-1 text-sm">
          {errors["schedules"][0]}
        </p>{/if}
    </div>
  {:else}
    <p class="border-glass-border text-text-secondary rounded-lg border px-4 py-3 text-sm">
      As-needed medications are logged when you take them. No reminders are sent and they don't
      count toward adherence.
    </p>
  {/if}

  <input type="hidden" name="scheduleMode" value={scheduleMode} />
  <input type="hidden" name="schedules" value={schedulesJson} />
  <input type="hidden" name="scheduleType" value={legacyScheduleType} />
  <input type="hidden" name="scheduleIntervalHours" value={legacyIntervalHours} />

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div>
      <label for="inventoryCount" class="mb-1 block text-sm font-medium">
        Inventory Count
        <Tooltip
          text="Track how many doses you have left. Automatically decreases when you log a dose."
        />
      </label>
      <input
        id="inventoryCount"
        name="inventoryCount"
        type="number"
        value={formValues["inventoryCount"] ?? medication?.inventoryCount?.toString() ?? ""}
        placeholder="e.g. 30"
        class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
      />
      {#if errors["inventoryCount"]?.[0]}<p class="text-danger mt-1 text-sm">
          {errors["inventoryCount"][0]}
        </p>{/if}
    </div>
    <div>
      <label for="inventoryAlertThreshold" class="mb-1 block text-sm font-medium">
        Low Stock Alert Threshold
        <Tooltip text="You'll see a warning when your remaining inventory drops to this number." />
      </label>
      <input
        id="inventoryAlertThreshold"
        name="inventoryAlertThreshold"
        type="number"
        value={formValues["inventoryAlertThreshold"] ??
          medication?.inventoryAlertThreshold?.toString() ??
          ""}
        placeholder="e.g. 7"
        class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
      />
      {#if errors["inventoryAlertThreshold"]?.[0]}<p class="text-danger mt-1 text-sm">
          {errors["inventoryAlertThreshold"][0]}
        </p>{/if}
    </div>
  </div>

  <div>
    <label for="notes" class="mb-1 block text-sm font-medium">Notes</label>
    <textarea
      id="notes"
      name="notes"
      rows="3"
      placeholder="Optional notes..."
      class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
      >{formValues["notes"] ?? medication?.notes ?? ""}</textarea
    >
    {#if errors["notes"]?.[0]}<p class="text-danger mt-1 text-sm">{errors["notes"][0]}</p>{/if}
  </div>

  <MedicalDisclaimer variant="inline" />

  <button
    type="submit"
    disabled={loading}
    class="bg-accent text-accent-fg w-full rounded-lg px-4 py-2.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
  >
    {loading ? "Saving..." : medication ? "Update Medication" : "Add Medication"}
  </button>
</form>
