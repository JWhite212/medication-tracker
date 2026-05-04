<script lang="ts">
  import { enhance } from "$app/forms";
  import { showToast } from "$components/ui/Toast.svelte";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import { groupSlotsByTimeOfDay } from "$lib/utils/schedule";
  import type { ScheduleSlot } from "$lib/utils/schedule";

  let {
    scheduleSlots,
    timezone,
    timeFormat = "12h",
  }: { scheduleSlots: ScheduleSlot[]; timezone: string; timeFormat?: TimeFormat } = $props();

  let groups = $derived(groupSlotsByTimeOfDay(scheduleSlots, timezone));
</script>

{#if groups.length > 0}
  <section>
    <h2 class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">My Day</h2>
    <div class="space-y-3">
      {#each groups as group (group.key)}
        <div class="border-glass-border bg-glass rounded-xl border p-4 backdrop-blur-xl">
          <h3
            class="text-text-secondary mb-2 flex items-center gap-2 text-xs font-medium tracking-wider uppercase"
          >
            <span>{group.icon}</span>
            <span>{group.label}</span>
          </h3>
          <div class="space-y-1.5">
            {#each group.slots as slot (`${slot.medicationId}-${slot.expectedTime}`)}
              {@const expectedDate = new Date(slot.expectedTime)}
              <div
                class="hover:bg-glass-hover flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors {slot.status ===
                'skipped'
                  ? 'opacity-60'
                  : ''}"
              >
                <!-- Status indicator -->
                {#if slot.status === "taken"}
                  <span
                    class="bg-success/20 text-success flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    aria-label="Taken"
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="2,6 5,9 10,3" />
                    </svg>
                  </span>
                {:else if slot.status === "skipped"}
                  <span
                    class="bg-warning/20 text-warning flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    aria-label="Skipped"
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="3" y1="3" x2="9" y2="9" />
                      <line x1="9" y1="3" x2="3" y2="9" />
                    </svg>
                  </span>
                {:else if slot.status === "overdue"}
                  <span
                    class="bg-warning/20 text-warning flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                    aria-label="Overdue"
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <line x1="6" y1="3" x2="6" y2="7" />
                      <circle cx="6" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                {:else}
                  <span
                    class="border-glass-border flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                    aria-label="Upcoming"
                  >
                    <span class="bg-text-muted/40 h-2 w-2 rounded-full"></span>
                  </span>
                {/if}

                <!-- Medication colour swatch -->
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  style="background: {getMedicationBackground(
                    slot.colour,
                    slot.colourSecondary,
                    slot.pattern,
                    true,
                  )}"
                ></span>

                <!-- Name + time -->
                <span class="text-text-primary min-w-0 flex-1 truncate text-sm font-medium">
                  {slot.medicationName}
                  <span class="text-text-muted">{slot.dosageAmount}{slot.dosageUnit}</span>
                </span>
                <span class="text-text-secondary shrink-0 text-xs">
                  {formatUserTime(expectedDate, timezone, timeFormat)}
                </span>

                <!-- Quick-log button for non-resolved slots -->
                {#if slot.status !== "taken" && slot.status !== "skipped"}
                  <form
                    method="POST"
                    action="?/logDose"
                    use:enhance={() => {
                      return async ({ result, update }) => {
                        if (result.type === "success") {
                          showToast(`${slot.medicationName} logged`, "success");
                        }
                        await update();
                      };
                    }}
                  >
                    <input type="hidden" name="medicationId" value={slot.medicationId} />
                    <input type="hidden" name="quantity" value="1" />
                    <button
                      type="submit"
                      class="text-accent hover:bg-accent/10 rounded-md px-2 py-0.5 text-xs font-medium transition-colors"
                      aria-label="Log {slot.medicationName}"
                    >
                      Log
                    </button>
                  </form>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>
{/if}
