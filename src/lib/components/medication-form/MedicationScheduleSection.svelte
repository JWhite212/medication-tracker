<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";
  import Toggle from "$lib/components/ui/Toggle.svelte";
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import { DAY_LABELS, type ScheduleMode } from "$lib/medications/medication-form-state";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

  let {
    mode = $bindable(),
    intervalHours = $bindable(),
    fixedTimes = $bindable(),
    daysOfWeek = $bindable(),
    errors,
  }: {
    mode: ScheduleMode;
    intervalHours: string;
    fixedTimes: string[];
    daysOfWeek: number[];
    errors: FormErrors;
  } = $props();

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
</script>

<div>
  <!-- A <span>, not a <label>: this heads a group of toggle buttons rather than
       labelling one control, matching "Times of day" and "Days of the week"
       below. The buttons are grouped so the heading names them as a set. -->
  <span class="mb-1 flex items-center text-sm font-medium">
    Schedule
    <Tooltip
      label="Schedule"
      text="Interval: every N hours. Fixed time: at one or more specific times of day. As needed (PRN): only when required, no reminders."
    />
  </span>
  <div class="flex gap-2" role="group" aria-label="Schedule">
    <Toggle pressed={mode === "interval"} onclick={() => (mode = "interval")} class="flex-1">
      Interval
    </Toggle>
    <Toggle pressed={mode === "fixed_time"} onclick={() => (mode = "fixed_time")} class="flex-1">
      Fixed time
    </Toggle>
    <Toggle pressed={mode === "prn"} onclick={() => (mode = "prn")} class="flex-1">
      As needed (PRN)
    </Toggle>
  </div>
</div>

{#if mode === "interval"}
  <div>
    <div class="mb-1 flex items-center text-sm font-medium">
      <label for="intervalHours">Every N hours</label>
      <Tooltip
        label="Every N hours"
        text="How many hours between doses. Used to calculate adherence and send overdue reminders."
      />
    </div>
    <input
      id="intervalHours"
      type="number"
      bind:value={intervalHours}
      placeholder="e.g. 8"
      min="0.5"
      max="72"
      step="0.5"
      aria-invalid={errors["schedules"]?.[0] ? "true" : undefined}
      aria-describedby={errors["schedules"]?.[0] ? "schedules-error" : undefined}
      class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
    />
    {#if errors["schedules"]?.[0]}<p
        id="schedules-error"
        class="text-danger-ink mt-1 text-sm"
        role="alert"
      >
        {errors["schedules"][0]}
      </p>{/if}
  </div>
{:else if mode === "fixed_time"}
  <div class="space-y-3">
    <div>
      <span class="mb-1 block text-sm font-medium">
        Times of day
        <Tooltip
          label="Times of day"
          text="One slot per scheduled time. Add multiple rows for twice-daily, three-times-daily, etc."
        />
      </span>
      <div class="space-y-2">
        {#each fixedTimes as _time, idx (idx)}
          <div class="flex items-center gap-2">
            <input
              type="time"
              bind:value={fixedTimes[idx]}
              class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink flex-1 rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
              aria-label="Time of day {idx + 1}"
            />
            <!-- Secondary, not red: removing a schedule row is undone by adding it
                 again. It keeps its visible word rather than an icon. -->
            <Button
              size="sm"
              disabled={fixedTimes.length <= 1}
              aria-label="Remove this time"
              onclick={() => removeFixedTime(idx)}>Remove</Button
            >
          </div>
        {/each}
      </div>
      <Button size="sm" class="mt-2" onclick={addFixedTime}>+ Add time</Button>
    </div>

    <div>
      <span class="mb-1 block text-sm font-medium">
        Days of the week
        <Tooltip
          label="Days of the week"
          text="Leave empty to apply every day. Select specific days (e.g. weekdays only) to restrict."
        />
      </span>
      <div class="flex flex-wrap gap-2">
        {#each DAY_LABELS as { value, short }}
          <Toggle pressed={daysOfWeek.includes(value)} onclick={() => toggleDay(value)}>
            {short}
          </Toggle>
        {/each}
      </div>
    </div>
    {#if errors["schedules"]?.[0]}<p
        id="schedules-error"
        class="text-danger-ink mt-1 text-sm"
        role="alert"
      >
        {errors["schedules"][0]}
      </p>{/if}
  </div>
{:else}
  <p class="border-glass-border text-text-secondary rounded-lg border px-4 py-3 text-sm">
    As-needed medications are logged when you take them. No reminders are sent and they don't count
    toward adherence.
  </p>
{/if}
