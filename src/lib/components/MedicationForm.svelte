<script lang="ts">
  import { enhance } from "$app/forms";
  import { tick } from "svelte";
  import type { Medication } from "$lib/types";
  import Input from "$lib/components/ui/Input.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { getMedicationBackground, PATTERN_OPTIONS } from "$lib/utils/medication-style";

  let {
    medication = undefined,
    errors = {},
    formValues = {},
  }: {
    medication?: Medication;
    errors?: Record<string, string[]>;
    formValues?: Record<string, string>;
  } = $props();

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

  let loading = $state(false);
  let scheduleType = $state(formValues["scheduleType"] ?? medication?.scheduleType ?? "scheduled");

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
    <div class="border-warning/30 bg-warning/5 rounded-lg border px-4 py-3">
      <p class="text-warning mb-1 text-xs font-medium">Potential Drug Interactions</p>
      {#each interactionWarnings as warning}
        <p class="text-text-secondary text-sm">{warning}</p>
      {/each}
      <p class="text-text-muted mt-2 text-xs">Advisory only — consult your healthcare provider.</p>
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
          class="flex h-8 items-center rounded-full px-4 text-xs font-medium text-white"
          style="background: {getMedicationBackground(
            selectedColour,
            selectedColourSecondary,
            selectedPattern,
          )}"
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
      Schedule Type
      <Tooltip
        text="Scheduled medications have a regular interval (e.g. every 8 hours). As-needed (PRN) medications are taken only when required and won't count toward adherence."
      />
    </label>
    <div class="flex gap-3">
      <button
        type="button"
        onclick={() => (scheduleType = "scheduled")}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleType ===
        'scheduled'
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        Scheduled
      </button>
      <button
        type="button"
        onclick={() => (scheduleType = "as_needed")}
        class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {scheduleType ===
        'as_needed'
          ? 'border-accent bg-accent/15 text-accent'
          : 'border-glass-border text-text-secondary hover:bg-glass-hover'}"
      >
        As Needed (PRN)
      </button>
    </div>
    <input type="hidden" name="scheduleType" value={scheduleType} />
  </div>

  {#if scheduleType === "scheduled"}
    <div>
      <label for="scheduleIntervalHours" class="mb-1 block text-sm font-medium">
        Schedule Interval (hours)
        <Tooltip
          text="How many hours between doses. Used to calculate adherence and send overdue reminders."
        />
      </label>
      <input
        id="scheduleIntervalHours"
        name="scheduleIntervalHours"
        type="number"
        value={formValues["scheduleIntervalHours"] ?? medication?.scheduleIntervalHours ?? ""}
        placeholder="e.g. 8"
        class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
      />
      {#if errors["scheduleIntervalHours"]?.[0]}<p class="text-danger mt-1 text-sm">
          {errors["scheduleIntervalHours"][0]}
        </p>{/if}
    </div>
  {/if}

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

  <button
    type="submit"
    disabled={loading}
    class="bg-accent text-accent-fg w-full rounded-lg px-4 py-2.5 font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
  >
    {loading ? "Saving..." : medication ? "Update Medication" : "Add Medication"}
  </button>
</form>
