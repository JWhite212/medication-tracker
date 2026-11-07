<script lang="ts">
  import { tick } from "svelte";
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

  // A stable key per row. Keyed by index, removing any row unmounted the LAST
  // row's DOM and relabelled the survivors, so pressing the last Remove
  // dropped focus to <body> and pressing another left focus on a button that
  // now named a different time. Ids are minted lazily, so a list the parent
  // replaces wholesale still gets one per row, and they are never reused, so
  // no two rows can share a key. Nothing here reacts to the array itself.
  const rowIds: number[] = [];
  let nextRowId = 0;
  function rowKey(idx: number): number {
    return (rowIds[idx] ??= nextRowId++);
  }

  // Each row's Remove button, by row id. A plain record bound through a getter
  // and a setter, as SideEffectPicker's are: binding to a member of a
  // non-reactive object warns binding_property_non_reactive in dev.
  const removeButtons: Record<number, HTMLButtonElement | HTMLAnchorElement | null> = {};

  /**
   * The only row left keeps its Remove, marked aria-disabled rather than
   * disabled: a focused control that becomes `disabled` drops focus to <body>.
   * aria-disabled does not stop a click, so this guard does.
   */
  async function removeFixedTime(idx: number) {
    if (fixedTimes.length <= 1) return;
    const pressed = removeButtons[rowKey(idx)];
    // Focus moves only if the press took it away: with nothing focused at the
    // tap (Safari focuses no button it taps) there is nothing to restore.
    const hadFocus = pressed != null && document.activeElement === pressed;
    // The next row's Remove, else the previous one's, chosen before the list
    // changes because afterwards there is no "next" to ask about.
    const neighbour = idx + 1 < fixedTimes.length ? rowKey(idx + 1) : rowKey(idx - 1);
    rowIds.splice(idx, 1);
    fixedTimes = fixedTimes.filter((_, i) => i !== idx);
    await tick();
    if (!hadFocus || pressed?.isConnected) return;
    removeButtons[neighbour]?.focus();
  }

  /** Named by the time it removes, so a list of buttons tells them apart. */
  function removeLabel(time: string, idx: number): string {
    return time ? `Remove ${time}` : `Remove time ${idx + 1}`;
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
  <div class="flex flex-wrap gap-2" role="group" aria-label="Schedule">
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
        {#each fixedTimes as time, idx (rowKey(idx))}
          <!-- The row's own id, so a row being torn down clears its own ref
               rather than whichever row now sits at its old index. -->
          {@const id = rowKey(idx)}
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
              ariaDisabled={fixedTimes.length <= 1}
              bind:ref={() => removeButtons[id] ?? null, (el) => (removeButtons[id] = el)}
              aria-label={removeLabel(time, idx)}
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
