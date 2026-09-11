<script lang="ts">
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
    <button
      type="button"
      onclick={() => (mode = "interval")}
      aria-pressed={mode === "interval"}
      class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {mode ===
      'interval'
        ? 'border-accent-ink bg-accent/15 text-accent-ink'
        : 'border-glass-border text-text-secondary hover:bg-surface-overlay'}"
    >
      Interval
    </button>
    <button
      type="button"
      onclick={() => (mode = "fixed_time")}
      aria-pressed={mode === "fixed_time"}
      class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {mode ===
      'fixed_time'
        ? 'border-accent-ink bg-accent/15 text-accent-ink'
        : 'border-glass-border text-text-secondary hover:bg-surface-overlay'}"
    >
      Fixed time
    </button>
    <button
      type="button"
      onclick={() => (mode = "prn")}
      aria-pressed={mode === "prn"}
      class="flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors {mode ===
      'prn'
        ? 'border-accent-ink bg-accent/15 text-accent-ink'
        : 'border-glass-border text-text-secondary hover:bg-surface-overlay'}"
    >
      As needed (PRN)
    </button>
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
            <button
              type="button"
              onclick={() => removeFixedTime(idx)}
              disabled={fixedTimes.length <= 1}
              class="border-glass-border text-text-secondary hover:text-danger-ink hover:border-danger-ink rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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
        class="border-glass-border text-text-secondary hover:bg-surface-overlay mt-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors"
      >
        + Add time
      </button>
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
          <button
            type="button"
            onclick={() => toggleDay(value)}
            aria-pressed={daysOfWeek.includes(value)}
            class="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors {daysOfWeek.includes(
              value,
            )
              ? 'border-accent-ink bg-accent/15 text-accent-ink'
              : 'border-glass-border text-text-secondary hover:bg-surface-overlay'}"
          >
            {short}
          </button>
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
