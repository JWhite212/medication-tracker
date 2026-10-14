<script lang="ts">
  // routes/(app)/dashboard/+page.svelte at DESKTOP_NOW (08:02): the header,
  // Lisinopril's due-now card, Done today, Later today, the chips and
  // Refills, top to bottom as the app orders them. The LogNow shot taps the
  // card's Log now. Two moments drive it, DESKTOP_BEFORE and DESKTOP_AFTER,
  // and the fidelity test proves both equal the real composer's payload.
  // `state` (Frame.dashboard) only says how far the stage has moved from one
  // to the other.
  //
  // Every marked element is mounted at every T. The Due section collapses
  // and the new Done row grows through StageCollapse, never through {#if},
  // so the rects measured near T=0 are the before-log layout.
  //
  // The spacing is the page's `space-y-6`, written as `mt-6` on each section
  // and `pt-6` inside the Due collapse, so the collapse takes its gap with it.
  import type { TimeFormat } from "$lib/utils/time";
  import { LOGGED_DOSE, WALKTHROUGH_TZ } from "../demo-data";
  import { DESKTOP_AFTER, DESKTOP_BEFORE } from "../demo-dashboard";
  import { STAGE_REFILLS, beatRow } from "../stage-dashboard";
  import { useMark } from "../marks";
  import type { Frame } from "../timeline";
  import StageChips from "../parts/dashboard/StageChips.svelte";
  import StageCollapse from "../parts/dashboard/StageCollapse.svelte";
  import StageDashboardHeader from "../parts/dashboard/StageDashboardHeader.svelte";
  import StageDoneList from "../parts/dashboard/StageDoneList.svelte";
  import StageDueCard from "../parts/dashboard/StageDueCard.svelte";
  import StageLaterList from "../parts/dashboard/StageLaterList.svelte";
  import StageRefills from "../parts/dashboard/StageRefills.svelte";

  let { state, timeFormat }: { state: Frame["dashboard"]; timeFormat: TimeFormat } = $props();

  const register = useMark();

  const before = DESKTOP_BEFORE;
  const after = DESKTOP_AFTER;
  /** The medication whose card the LogNow shot taps. */
  const tapped = beatRow(after, LOGGED_DOSE.desktop).dose.medicationId;
  /**
   * BEFORE's Due cards. The log resolves the only due row, so AFTER has
   * none and the whole section collapses with `logged`. A card AFTER alone
   * had would not be drawn, and the fidelity test's after-render would fail.
   */
  const dueCards = [...before.earlier, ...before.today];
  const dueStays = after.earlier.length + after.today.length > 0;
</script>

<div class="mx-auto w-full max-w-2xl">
  <StageDashboardHeader
    before={before.status}
    after={after.status}
    logged={state.logged}
    now={before.now}
    tz={WALKTHROUGH_TZ}
    {timeFormat}
    mark="d.header"
  />

  <StageCollapse factor={dueStays ? 1 : 1 - state.logged}>
    <div class="pt-6">
      <div use:register={"d.due"} data-stage-section="due" class="space-y-3">
        {#each dueCards as card (card.key)}
          <StageDueCard
            {card}
            now={before.now}
            todayStart={before.todayStart}
            tz={WALKTHROUGH_TZ}
            {timeFormat}
            pending={card.medicationId === tapped ? state.pending : null}
            logNowMark={card.medicationId === tapped ? "d.logNow" : undefined}
          />
        {/each}
      </div>
    </div>
  </StageCollapse>

  <div class="mt-6">
    <StageDoneList
      before={before.done}
      after={after.done}
      logged={state.logged}
      todayStart={before.todayStart}
      tz={WALKTHROUGH_TZ}
      {timeFormat}
      mark="d.done"
    />
  </div>

  <div class="mt-6">
    <StageLaterList
      rows={before.later}
      now={before.now}
      todayStart={before.todayStart}
      tz={WALKTHROUGH_TZ}
      {timeFormat}
      mark="d.later"
    />
  </div>

  <div class="mt-6">
    <StageChips medications={before.medications} mark="d.chips" />
  </div>

  <div class="mt-6">
    <StageRefills entries={STAGE_REFILLS} />
  </div>
</div>
