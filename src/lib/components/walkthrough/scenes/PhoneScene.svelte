<script lang="ts">
  // The dashboard as a phone shows it (MobileHeader.svelte over
  // routes/(app)/dashboard, below md) in a dark iPhone frame, at PHONE_NOW
  // (10:12). Vitamin D's 09:05 dose is an hour overdue, so its push drops in,
  // then the fingertip taps the card's Log now. PHONE_BEFORE and PHONE_AFTER
  // are the two halves of that beat, and the fidelity test proves both equal
  // the real composer's payload. `state` (Frame.phone) only says how far the
  // stage has moved from one to the other.
  //
  // The parts are the desktop scene's, at 402px. A shared part takes its mark
  // keys as props, so only Log now is marked here, as `p.vitdLog`: the
  // fingertip is placed from its rect. Every marked element is mounted at
  // every T; the card collapses and the new Done row grows through
  // StageCollapse, never through {#if}.
  //
  // Later shows a chosen prefix of whole rows (PHONE_LATER_ROWS); the content
  // box (732px, 820 − 72 − 16) has room below it. The phone draws no chips or
  // Refills: on a real phone they would be below the fold.
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import { formatUserTime, lastLoggedPhrase, type TimeFormat } from "$lib/utils/time";
  import { LOGGED_DOSE, PHONE_NOW, WALKTHROUGH_TZ } from "../demo-data";
  import { PHONE_AFTER, PHONE_BEFORE, PHONE_LATER_ROWS } from "../demo-dashboard";
  import { PHONE_ROOT, useMark } from "../marks";
  import { beatRow, lastEventBefore, stageLogToast } from "../stage-dashboard";
  import type { Frame } from "../timeline";
  import StageCollapse from "../parts/dashboard/StageCollapse.svelte";
  import StageDashboardHeader from "../parts/dashboard/StageDashboardHeader.svelte";
  import StageDoneList from "../parts/dashboard/StageDoneList.svelte";
  import StageDueCard from "../parts/dashboard/StageDueCard.svelte";
  import StageLaterList from "../parts/dashboard/StageLaterList.svelte";
  import StageUndoOffer from "../parts/dashboard/StageUndoOffer.svelte";

  let { state, timeFormat }: { state: Frame["phone"]; timeFormat: TimeFormat } = $props();

  const mark = useMark();
  const IOS_FONT = '-apple-system, "SF Pro", system-ui, sans-serif';

  const before = PHONE_BEFORE;
  const after = PHONE_AFTER;
  /** The dose the fingertip logs. */
  const tappedDose = beatRow(after, LOGGED_DOSE.phone).dose;
  /** The medication whose card the fingertip taps. */
  const tapped = tappedDose.medicationId;
  /**
   * BEFORE's Due cards. The tap resolves the only due row, so AFTER has none
   * and the whole section collapses with `logged`.
   */
  const dueCards = [...before.earlier, ...before.today];
  const dueStays = after.earlier.length + after.today.length > 0;
  /** A prefix of the composer's Later list, cut at a whole row. */
  const laterRows = before.later.slice(0, PHONE_LATER_ROWS);
  // The status bar shows the device clock, which is independent of the app's
  // time-format preference; we draw it in 24h. At the story's 10:12 the 24h
  // and 12h forms (less am/pm) agree.
  const clock = formatUserTime(PHONE_NOW, WALKTHROUGH_TZ, "24h");
  // The overdue push as reminders.ts sends it: the title names the
  // medication, and the body is lastLoggedPhrase over its last event. It was
  // sent before the tap, so that event is the one before PHONE_NOW.
  const bannerTitle = `${tappedDose.name} overdue`;
  const bannerBody = lastLoggedPhrase(lastEventBefore(tapped, PHONE_NOW), PHONE_NOW);
  // The tap's Undo offer, as Log now's reload would word it.
  const offerMessage = $derived(stageLogToast(after, LOGGED_DOSE.phone, timeFormat));
</script>

<!-- Device frame -->
<div
  class="relative h-[874px] w-[402px] overflow-hidden rounded-[48px] bg-black antialiased"
  style:box-shadow="0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)"
  style:font-family={IOS_FONT}
>
  <!-- Dynamic island -->
  <div
    class="absolute top-[11px] left-1/2 z-50 h-[37px] w-[126px] -translate-x-1/2 rounded-3xl bg-black"
  ></div>

  <!-- Status bar -->
  <div class="absolute top-0 right-0 left-0 z-10">
    <div
      class="relative z-20 flex w-full items-center justify-center gap-[154px] px-6 pt-[21px] pb-[19px]"
    >
      <div class="flex h-[22px] flex-1 items-center justify-center pt-[1.5px]">
        <span data-stage-clock class="text-[17px] leading-[22px] font-[590] text-white"
          >{clock}</span
        >
      </div>
      <div class="flex h-[22px] flex-1 items-center justify-center gap-[7px] pt-px pr-px">
        <svg width="19" height="12" viewBox="0 0 19 12" fill="#fff">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="#fff">
          <path
            d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z"
          />
          <path
            d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z"
          />
          <circle cx="8.5" cy="10.5" r="1.5" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect
            x="0.5"
            y="0.5"
            width="23"
            height="12"
            rx="3.5"
            stroke="#fff"
            stroke-opacity="0.35"
            fill="none"
          />
          <rect x="2" y="2" width="20" height="9" rx="2" fill="#fff" />
          <path
            d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z"
            fill="#fff"
            fill-opacity="0.4"
          />
        </svg>
      </div>
    </div>
  </div>

  <!-- The app, full-bleed under the status bar -->
  <div
    use:mark={PHONE_ROOT}
    class="bg-surface text-text-primary relative h-[874px] w-[402px] overflow-hidden text-left font-sans text-base"
  >
    <div class="absolute top-[54px] right-0 bottom-0 left-0">
      <div
        class="bg-surface-raised border-glass-border absolute top-0 right-0 left-0 z-20 flex h-14 items-center justify-between border-b px-4"
      >
        <div class="text-text-secondary flex h-9 w-9 items-center justify-center rounded-lg">
          <svg
            width="20"
            height="20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            /></svg
          >
        </div>
        <div class="flex items-center gap-2 text-lg font-semibold">
          <img src={appIcon} alt="" width="28" height="28" class="h-7 w-7 rounded-md" />
          <span>MedTracker</span>
        </div>
        <div
          class="bg-accent/15 text-accent-ink flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
        >
          D
        </div>
      </div>
      <div class="absolute inset-0 overflow-hidden px-4 pt-[72px] pb-4">
        <StageDashboardHeader
          before={before.status}
          after={after.status}
          logged={state.logged}
          now={before.now}
          tz={WALKTHROUGH_TZ}
          {timeFormat}
        />

        <StageCollapse factor={dueStays ? 1 : 1 - state.logged}>
          <div class="pt-6">
            <div data-stage-section="due" class="space-y-3">
              {#each dueCards as card (card.key)}
                <StageDueCard
                  {card}
                  now={before.now}
                  todayStart={before.todayStart}
                  tz={WALKTHROUGH_TZ}
                  {timeFormat}
                  pending={card.medicationId === tapped ? state.pending : null}
                  logNowMark={card.medicationId === tapped ? "p.vitdLog" : undefined}
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
          />
        </div>

        <div class="mt-6">
          <StageLaterList
            rows={laterRows}
            now={before.now}
            todayStart={before.todayStart}
            tz={WALKTHROUGH_TZ}
            {timeFormat}
          />
        </div>
      </div>

      <!-- Where Toast's stack sits (fixed right-4 bottom-4 in the app), lifted
           clear of the home indicator -->
      <div class="absolute right-4 bottom-[42px] z-50 flex flex-col gap-2">
        <StageUndoOffer message={offerMessage} opacity={state.offer} />
      </div>
    </div>

    <!-- Web Push as src/lib/server/reminders.ts sends it -->
    <div
      class="absolute top-[54px] right-2.5 left-2.5 z-[70] flex items-center gap-3 rounded-3xl px-3.5 py-3 text-white"
      style:transform="translateY({state.bannerY}px)"
      style:background="rgba(44,44,50,0.96)"
      style:box-shadow="0 10px 30px rgba(0,0,0,0.35)"
      style:font-family={IOS_FONT}
    >
      <img
        src={appIcon}
        alt=""
        width="38"
        height="38"
        class="h-[38px] w-[38px] shrink-0 rounded-[9px]"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-[15px] leading-5 font-semibold">{bannerTitle}</span>
          <span class="text-[13px] leading-[18px]" style:color="rgba(235,235,245,0.6)">now</span>
        </div>
        <div data-stage-banner class="text-[15px] leading-5" style:color="rgba(255,255,255,0.92)">
          {bannerBody}
        </div>
      </div>
    </div>

    {#if state.touch && state.touch.opacity > 0}
      <!-- A fingertip, since there is no cursor on a phone -->
      <div
        class="absolute z-[80] h-11 w-11 rounded-full"
        style:left="{state.touch.x - 22}px"
        style:top="{state.touch.y - 22}px"
        style:background="rgba(255,255,255,0.28)"
        style:border="1.5px solid rgba(255,255,255,0.6)"
        style:opacity={state.touch.opacity}
        style:transform="scale({1 - 0.15 * state.touch.press})"
      ></div>
    {/if}
  </div>

  <!-- Home indicator -->
  <div
    class="pointer-events-none absolute right-0 bottom-0 left-0 z-[60] flex h-[34px] items-end justify-center pb-2"
  >
    <div class="h-[5px] w-[139px] rounded-full" style:background="rgba(255,255,255,0.7)"></div>
  </div>
</div>
