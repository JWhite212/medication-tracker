<script lang="ts">
  // routes/(app)/dashboard/+page.svelte at 08:02: Lisinopril is due now and is
  // logged from the Quick Log bar during the QuickLog shot.
  import { getMedicationBackground, getReadableTextColor } from "$lib/utils/medication-style";
  import { formatDueIn, type TimeFormat } from "$lib/utils/time";
  import { MEDICATIONS, MEDICATION_BY_ID, daySlots, storyClock } from "../demo-data";
  import { useMark } from "../marks";
  import type { Frame } from "../timeline";
  import DoseEntry from "../parts/DoseEntry.svelte";
  import MyDaySection from "../parts/MyDaySection.svelte";
  import SummaryAndRefills from "../parts/SummaryAndRefills.svelte";

  let { state, timeFormat }: { state: Frame["dashboard"]; timeFormat: TimeFormat } = $props();

  const mark = useMark();
  const slots = daySlots("upcoming", "upcoming");

  // Quick Log labels under the pills that have one.
  const LABELS: Partial<Record<string, { text: string; kind: "due_now" | "upcoming" }>> = {
    lis: { text: "Due now", kind: "due_now" },
    vitd: { text: formatDueIn(63 * 60_000), kind: "upcoming" },
  };

  /** The expanding green ring QuickLogBar flashes on a successful log. */
  function flashShadow(p: number): string {
    if (p <= 0 || p >= 1) return "none";
    const spread = p < 0.5 ? 8 * p : 8 * (1 - p);
    const alpha = p < 0.5 ? 0.6 - 0.6 * p : 0.6 * (1 - p);
    return `0 0 0 ${spread.toFixed(2)}px rgba(16,185,129,${alpha.toFixed(3)})`;
  }
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <p class="text-2xl font-bold">Dashboard</p>
  <SummaryAndRefills count={state.count} markKey="d.strip" />
  <MyDaySection
    {slots}
    {timeFormat}
    done={{ "lis08:00": state.lisinoprilDone }}
    markPrefix="d."
    logMarks={{ "lis08:00": "d.lisLog" }}
  />

  <div use:mark={"d.quick"}>
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Quick Log</p>
    <div class="flex flex-wrap gap-3">
      {#each MEDICATIONS as medication (medication.id)}
        {@const isLisinopril = medication.id === "lis"}
        {@const label = LABELS[medication.id]}
        {@const text = getReadableTextColor(
          medication.colour,
          medication.colourSecondary,
          medication.pattern,
        )}
        {@const gone = isLisinopril ? state.labelGone : 0}
        <div class="flex flex-col items-center gap-1">
          <div
            class="flex items-center overflow-hidden rounded-full text-sm font-medium whitespace-nowrap"
            style:background={getMedicationBackground(
              medication.colour,
              medication.colourSecondary,
              medication.pattern,
            )}
            style:color={text.color}
            style:text-shadow={text.textShadow}
            style:box-shadow={isLisinopril ? flashShadow(state.flash) : "none"}
          >
            <div
              use:mark={isLisinopril ? "d.lisPill" : undefined}
              class="flex items-center gap-2 px-4 py-2"
              style:background={isLisinopril && state.pillHover ? text.hoverOverlay : "transparent"}
              style:transform={isLisinopril && state.pillPress
                ? `scale(${1 - 0.05 * state.pillPress})`
                : undefined}
            >
              <span>{medication.name}</span><span class="opacity-70"
                >{medication.amount}{medication.unit}</span
              >
            </div>
            <div class="p-2 leading-none opacity-70">+</div>
          </div>
          {#if label && gone < 1}
            <div
              class="overflow-hidden"
              style:height="{16 * (1 - gone)}px"
              style:margin-top="{-4 * gone}px"
            >
              <span
                class="block text-xs font-medium {label.kind === 'due_now'
                  ? 'text-accent-ink'
                  : 'text-text-muted'}"
                style:opacity={(isLisinopril ? state.pulse : 1) * (1 - gone)}>{label.text}</span
              >
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div>
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Today</p>
    <div use:mark={"d.today"} class="flex flex-col">
      <!-- The new entry grows in above the existing ones once the dose is logged -->
      <div class="shrink-0 overflow-hidden" style:height="{66 * state.entry}px">
        <div style:opacity={state.entry} style:transform="translateY({(1 - state.entry) * 4}px)">
          <DoseEntry
            medication={MEDICATION_BY_ID.lis}
            time={storyClock("08:02", timeFormat)}
            since="just now"
          />
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <DoseEntry
          medication={MEDICATION_BY_ID.met}
          time={storyClock("07:48", timeFormat)}
          since="14m ago"
        />
        <DoseEntry
          medication={MEDICATION_BY_ID.ibu}
          time={storyClock("06:10", timeFormat)}
          since="1h 52m ago"
        />
      </div>
    </div>
  </div>
</div>
