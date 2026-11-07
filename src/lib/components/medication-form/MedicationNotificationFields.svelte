<script lang="ts">
  import { untrack } from "svelte";
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

  let enabled = $state(untrack(() => notificationsEnabled));

  // Every choice is held here for the whole visit, seeded once from the props
  // (as `enabled` is). Unticking "Notify me" unmounts the selects, so a value
  // that lived only in the DOM was lost: the hidden inputs below posted the
  // props, and re-ticking remounted the selects at the props too.
  let choices = $state<Record<string, NotificationChoice>>(
    untrack(() => ({
      notifyOverdueEmail: overdueEmail,
      notifyOverduePush: overduePush,
      notifyLowInventoryEmail: lowInventoryEmail,
      notifyLowInventoryPush: lowInventoryPush,
    })),
  );
  let offset = $state(untrack(() => offsetMinutes));
  let repeatEvery = $state(untrack(() => repeatEveryMinutes));
  let repeats = $state(untrack(() => maxRepeats));

  const SELECTS: { name: string; label: string }[] = [
    { name: "notifyOverdueEmail", label: "Missed dose — email" },
    { name: "notifyOverduePush", label: "Missed dose — push" },
    { name: "notifyLowInventoryEmail", label: "Low stock — email" },
    { name: "notifyLowInventoryPush", label: "Low stock — push" },
  ];

  type Option = { value: string; label: string };

  const OFFSET_OPTIONS: Option[] = [
    { value: "0", label: "Straight away" },
    { value: "30", label: "30 minutes" },
    { value: "60", label: "1 hour" },
  ];
  const REPEAT_OPTIONS: Option[] = [
    { value: "", label: "Don't repeat" },
    { value: "30", label: "Every 30 minutes" },
    { value: "60", label: "Every hour" },
    { value: "120", label: "Every 2 hours" },
  ];
  const MAX_REPEAT_OPTIONS: Option[] = [
    { value: "0", label: "Just once" },
    { value: "1", label: "1 more reminder" },
    { value: "2", label: "2 more reminders" },
    { value: "3", label: "3 more reminders" },
    { value: "5", label: "5 more reminders" },
  ];

  function minutesPhrase(value: string): string {
    if (!/^\d+$/.test(value)) return value;
    const n = Number(value);
    if (n > 0 && n % 60 === 0) return n === 60 ? "1 hour" : `${n / 60} hours`;
    return n === 1 ? "1 minute" : `${n} minutes`;
  }

  /**
   * The options above are a short list, but every door (`/api/v1`, import,
   * the Mac app) accepts the schema's full range. A stored value with no
   * matching option left the select with nothing selected, so it was omitted
   * from FormData and the server's defaults silently replaced the stored
   * timing on the next save. Offer it as one more option, so it round-trips.
   */
  function withStored(options: Option[], stored: string, label: (v: string) => string): Option[] {
    return options.some((o) => o.value === stored)
      ? options
      : [...options, { value: stored, label: `${label(stored)} (custom)` }];
  }

  const offsetOptions = $derived(withStored(OFFSET_OPTIONS, offsetMinutes, minutesPhrase));
  const repeatOptions = $derived(
    withStored(REPEAT_OPTIONS, repeatEveryMinutes, (v) => `Every ${minutesPhrase(v)}`),
  );
  const maxRepeatOptions = $derived(
    withStored(MAX_REPEAT_OPTIONS, maxRepeats, (v) =>
      v === "1" ? "1 more reminder" : `${v} more reminders`,
    ),
  );
</script>

<!-- aria-labelledby scopes the group's name to the legend's TEXT. A fieldset is
     named by its whole legend subtree, so the Tooltip button inside it would
     otherwise fold its own name in and the group would announce as
     "Notifications More info about Notifications". -->
<fieldset class="border-glass-border rounded-lg border p-4" aria-labelledby="notificationsLegend">
  <legend class="px-2 text-sm font-medium">
    <span id="notificationsLegend">Notifications</span>
    <Tooltip
      label="Notifications"
      text="Overrides your account-wide notification settings for this medication only."
    />
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
      class="accent-accent size-4 rounded-xs"
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
            bind:value={choices[field.name]}
            aria-invalid={errors[field.name]?.[0] ? "true" : undefined}
            aria-describedby={errors[field.name]?.[0] ? `${field.name}-error` : undefined}
            class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          >
            <option value="inherit">Use account default</option>
            <option value="on">Always</option>
            <option value="off">Never</option>
          </select>
          {#if errors[field.name]?.[0]}<p
              id={`${field.name}-error`}
              class="text-danger-ink mt-1 text-sm"
              role="alert"
            >
              {errors[field.name]?.[0]}
            </p>{/if}
        </div>
      {/each}
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div>
        <div class="mb-1 flex items-center text-sm font-medium">
          <label for="notifyOffsetMinutes">Remind me after</label>
          <Tooltip
            label="Remind me after"
            text="How long after the scheduled time to send the first reminder. Reminders can only be sent after a dose is due, never before."
          />
        </div>
        <select
          id="notifyOffsetMinutes"
          name="notifyOffsetMinutes"
          bind:value={offset}
          class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          {#each offsetOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div>
        <div class="mb-1 flex items-center text-sm font-medium">
          <label for="notifyRepeatEveryMinutes">Then repeat</label>
          <Tooltip
            label="Then repeat"
            text="Reminders repeat until you log or skip the dose. The shortest interval available is 30 minutes, because that is how often the reminder service runs."
          />
        </div>
        <select
          id="notifyRepeatEveryMinutes"
          name="notifyRepeatEveryMinutes"
          bind:value={repeatEvery}
          class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          {#each repeatOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="notifyMaxRepeats" class="mb-1 block text-sm font-medium">Give up after</label>
        <select
          id="notifyMaxRepeats"
          name="notifyMaxRepeats"
          bind:value={repeats}
          class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          {#each maxRepeatOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>
    </div>
  {:else}
    <!-- The selects are hidden but their values must still submit, or
         toggling the kill switch off and on again would silently reset
         every per-channel choice to inherit. They post the in-visit state,
         not the props, so a choice made before unticking is kept. -->
    {#each SELECTS as field (field.name)}
      <input type="hidden" name={field.name} value={choices[field.name]} />
    {/each}
    <input type="hidden" name="notifyOffsetMinutes" value={offset} />
    <input type="hidden" name="notifyRepeatEveryMinutes" value={repeatEvery} />
    <input type="hidden" name="notifyMaxRepeats" value={repeats} />
  {/if}
</fieldset>
