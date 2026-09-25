<script lang="ts">
  // Depicts the dashboard's former "My Day" timeline (today's slots grouped by
  // time of day). The dashboard is now grouped by action (Due, Done today,
  // Later today) and this scene has not been redrawn to match. `done` maps a
  // slot key (medication id + time) to 0..1 as it animates from its current
  // status to taken, which also collapses its "Log" button.
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import type { TimeFormat } from "$lib/utils/time";
  import { DAY_GROUPS, MEDICATION_BY_ID, storyClock, type DaySlot } from "../demo-data";
  import { useMark } from "../marks";
  import StatusMark from "./StatusMark.svelte";

  let {
    slots,
    timeFormat,
    done = {},
    markPrefix,
    logMarks = {},
  }: {
    slots: DaySlot[];
    timeFormat: TimeFormat;
    done?: Record<string, number>;
    markPrefix: string;
    logMarks?: Record<string, string>;
  } = $props();

  const mark = useMark();
  const slotKey = (slot: DaySlot) => slot.id + slot.time;
</script>

<div>
  <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">My Day</p>
  <div class="flex flex-col gap-3">
    {#each DAY_GROUPS as group (group.key)}
      <div
        use:mark={markPrefix + group.key}
        class="border-glass-border bg-glass rounded-xl border p-4"
      >
        <p
          class="text-text-secondary mb-2 flex items-center gap-2 text-xs font-medium tracking-wider uppercase"
        >
          <span>{group.icon}</span><span>{group.label}</span>
        </p>
        <div class="flex flex-col gap-1.5">
          {#each slots.filter((s) => s.group === group.key) as slot (slotKey(slot))}
            {@const medication = MEDICATION_BY_ID[slot.id]}
            {@const progress = done[slotKey(slot)] ?? 0}
            {@const resolved = slot.status === "taken"}
            <div class="flex items-center gap-3 rounded-lg px-2 py-1.5">
              <span class="relative h-5 w-5 shrink-0">
                {#if resolved}
                  <StatusMark kind="taken" />
                {:else}
                  <span class="absolute inset-0" style:opacity={1 - progress}>
                    <StatusMark kind={slot.status} />
                  </span>
                  {#if progress > 0}
                    <span
                      class="absolute inset-0"
                      style:opacity={progress}
                      style:transform="scale({0.6 + 0.4 * progress})"
                    >
                      <StatusMark kind="taken" />
                    </span>
                  {/if}
                {/if}
              </span>
              <span
                class="h-2.5 w-2.5 shrink-0 rounded-full"
                style:background={getMedicationBackground(
                  medication.colour,
                  medication.colourSecondary,
                  medication.pattern,
                  true,
                )}
              ></span>
              <span class="text-text-primary min-w-0 flex-1 truncate text-sm font-medium"
                >{medication.name}
                <span class="text-text-muted">{medication.amount}{medication.unit}</span></span
              >
              <span class="text-text-secondary shrink-0 text-xs"
                >{storyClock(slot.time, timeFormat)}</span
              >
              {#if !resolved}
                <div
                  use:mark={logMarks[slotKey(slot)]}
                  class="shrink-0 overflow-hidden"
                  style:max-width="{48 * (1 - progress)}px"
                  style:margin-left="{-12 * progress}px"
                  style:opacity={1 - Math.min(1, progress * 2)}
                >
                  <span class="text-accent-ink block rounded-md px-2 py-0.5 text-xs font-medium"
                    >Log</span
                  >
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
