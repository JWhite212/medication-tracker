<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import type { FormErrors } from "$lib/medications/medication-form-errors";
  import type { NotificationChoice } from "$lib/medications/medication-form-state";

  let {
    notificationsEnabled,
    overdueEmail,
    overduePush,
    lowInventoryEmail,
    lowInventoryPush,
    offsetMinutes,
    repeatEveryMinutes,
    maxRepeats,
    errors,
  }: {
    notificationsEnabled: boolean;
    overdueEmail: NotificationChoice;
    overduePush: NotificationChoice;
    lowInventoryEmail: NotificationChoice;
    lowInventoryPush: NotificationChoice;
    offsetMinutes: string;
    repeatEveryMinutes: string;
    maxRepeats: string;
    errors: FormErrors;
  } = $props();

  let enabled = $state(notificationsEnabled);

  const SELECTS: { name: string; label: string; value: NotificationChoice }[] = $derived([
    { name: "notifyOverdueEmail", label: "Missed dose — email", value: overdueEmail },
    { name: "notifyOverduePush", label: "Missed dose — push", value: overduePush },
    { name: "notifyLowInventoryEmail", label: "Low stock — email", value: lowInventoryEmail },
    { name: "notifyLowInventoryPush", label: "Low stock — push", value: lowInventoryPush },
  ]);
</script>

<fieldset class="border-glass-border rounded-lg border p-4">
  <legend class="px-2 text-sm font-medium">
    Notifications
    <Tooltip text="Overrides your account-wide notification settings for this medication only." />
  </legend>

  <!-- An unchecked checkbox submits nothing, and an absent
       notificationsEnabled means "enabled" (an API client omitted it,
       not "the user cleared it"). This hidden input makes the form
       always submit an explicit value: Object.fromEntries keeps the LAST
       value for a repeated name and FormData iterates in DOM order, so
       unchecked yields "off" and checked yields "on". Do not reorder. -->
  <input type="hidden" name="notificationsEnabled" value="off" />
  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      name="notificationsEnabled"
      bind:checked={enabled}
      class="accent-accent size-4 rounded"
    />
    Notify me about this medication
  </label>

  {#if enabled}
    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      {#each SELECTS as field (field.name)}
        <div>
          <label for={field.name} class="mb-1 block text-sm font-medium">{field.label}</label>
          <select
            id={field.name}
            name={field.name}
            value={field.value}
            class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          >
            <option value="inherit">Use account default</option>
            <option value="on">Always</option>
            <option value="off">Never</option>
          </select>
          {#if errors[field.name]?.[0]}<p class="text-danger mt-1 text-sm">
              {errors[field.name]?.[0]}
            </p>{/if}
        </div>
      {/each}
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div>
        <label for="notifyOffsetMinutes" class="mb-1 block text-sm font-medium">
          Remind me after
          <Tooltip
            text="How long after the scheduled time to send the first reminder. Reminders can only be sent after a dose is due, never before."
          />
        </label>
        <select
          id="notifyOffsetMinutes"
          name="notifyOffsetMinutes"
          value={offsetMinutes}
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          <option value="0">Straight away</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
        </select>
      </div>

      <div>
        <label for="notifyRepeatEveryMinutes" class="mb-1 block text-sm font-medium">
          Then repeat
          <Tooltip
            text="Reminders repeat until you log or skip the dose. The shortest interval available is 30 minutes, because that is how often the reminder service runs."
          />
        </label>
        <select
          id="notifyRepeatEveryMinutes"
          name="notifyRepeatEveryMinutes"
          value={repeatEveryMinutes}
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          <option value="">Don't repeat</option>
          <option value="30">Every 30 minutes</option>
          <option value="60">Every hour</option>
          <option value="120">Every 2 hours</option>
        </select>
      </div>

      <div>
        <label for="notifyMaxRepeats" class="mb-1 block text-sm font-medium">Give up after</label>
        <select
          id="notifyMaxRepeats"
          name="notifyMaxRepeats"
          value={maxRepeats}
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          <option value="0">Just once</option>
          <option value="1">1 more reminder</option>
          <option value="2">2 more reminders</option>
          <option value="3">3 more reminders</option>
          <option value="5">5 more reminders</option>
        </select>
      </div>
    </div>
  {:else}
    <!-- The selects are hidden but their values must still submit, or
         toggling the kill switch off and on again would silently reset
         every per-channel choice to inherit. -->
    {#each SELECTS as field (field.name)}
      <input type="hidden" name={field.name} value={field.value} />
    {/each}
    <input type="hidden" name="notifyOffsetMinutes" value={offsetMinutes} />
    <input type="hidden" name="notifyRepeatEveryMinutes" value={repeatEveryMinutes} />
    <input type="hidden" name="notifyMaxRepeats" value={maxRepeats} />
  {/if}
</fieldset>
