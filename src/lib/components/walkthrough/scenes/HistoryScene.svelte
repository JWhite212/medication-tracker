<script lang="ts">
  // routes/(app)/log/+page.svelte: the filter form, then the dose groups. When
  // "With side effects" is ticked the full list cross-fades to the filtered one.
  import type { TimeFormat } from "$lib/utils/time";
  import {
    LOG_ALL,
    LOG_WITH_SIDE_EFFECTS,
    MEDICATION_BY_ID,
    storyClock,
    type DoseGroup,
  } from "../demo-data";
  import { useMark } from "../marks";
  import DoseEntry from "../parts/DoseEntry.svelte";
  import Glyph from "../parts/Glyph.svelte";

  let {
    checked,
    filtered,
    timeFormat,
  }: { checked: boolean; filtered: number; timeFormat: TimeFormat } = $props();

  const mark = useMark();
  const control =
    "border-border-strong bg-surface-raised text-text-primary flex items-center gap-2 rounded-lg border px-3 py-2 text-sm whitespace-nowrap";
</script>

{#snippet doseGroups(groups: readonly DoseGroup[])}
  <div>
    {#each groups as group (group.label)}
      <div>
        <div class="-mx-1 px-1 py-2">
          <p class="text-text-secondary text-sm font-medium">{group.label}</p>
        </div>
        <div class="flex flex-col gap-2 pb-4">
          {#each group.doses as dose, k (k)}
            <DoseEntry
              medication={MEDICATION_BY_ID[dose.id]}
              time={storyClock(dose.time, timeFormat)}
              since={dose.since}
              sideEffect={dose.sideEffect}
            />
          {/each}
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <p use:mark={"l.h1"} class="text-2xl font-bold">Dose History</p>
  <div
    use:mark={"l.form"}
    class="border-glass-border bg-glass flex flex-wrap gap-3 rounded-xl border p-4"
  >
    <div class={control}>
      All medications<Glyph name="chevron" color="var(--color-text-primary)" />
    </div>
    <div class={control}>
      Any status<Glyph name="chevron" color="var(--color-text-primary)" />
    </div>
    <div class={control}><span>dd/mm/yyyy</span><Glyph name="calendar" /></div>
    <span class="text-text-muted self-center">to</span>
    <div class={control}><span>dd/mm/yyyy</span><Glyph name="calendar" /></div>
    <div class="{control} text-text-muted! w-48">Search notes…</div>
    <div class="text-text-secondary flex items-center gap-2 text-sm">
      <!-- Chrome's native dark checkbox, since the real page does not restyle it -->
      <span use:mark={"l.check"}>
        <span
          class="flex h-4 w-4 items-center justify-center rounded-[3px] border"
          style:border-color={checked ? "#99c8ff" : "#858585"}
          style:background={checked ? "#99c8ff" : "#3b3b3b"}
        >
          {#if checked}
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="#1f1f1f"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"><polyline points="2.5,6.2 5,8.6 9.5,3.6" /></svg
            >
          {/if}
        </span>
      </span>
      With side effects
    </div>
    <div class="{control} text-text-secondary!">Apply</div>
  </div>
  <div class="relative">
    <div style:opacity={1 - filtered}>{@render doseGroups(LOG_ALL)}</div>
    {#if filtered > 0}
      <div class="absolute top-0 right-0 left-0" style:opacity={filtered}>
        {@render doseGroups(LOG_WITH_SIDE_EFFECTS)}
      </div>
    {/if}
  </div>
</div>
