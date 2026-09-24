<script lang="ts">
  // The mobile dashboard (MobileHeader.svelte plus the dashboard below md) in
  // a dark iPhone frame. A Vitamin D overdue push drops in, then the dose is
  // logged from My Day.
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import type { TimeFormat } from "$lib/utils/time";
  import { daySlots } from "../demo-data";
  import { PHONE_ROOT, useMark } from "../marks";
  import type { Frame } from "../timeline";
  import MyDaySection from "../parts/MyDaySection.svelte";
  import StageToast from "../parts/StageToast.svelte";
  import SummaryAndRefills from "../parts/SummaryAndRefills.svelte";

  let { state, timeFormat }: { state: Frame["phone"]; timeFormat: TimeFormat } = $props();

  const mark = useMark();
  const slots = daySlots("taken", "overdue");
  const IOS_FONT = '-apple-system, "SF Pro", system-ui, sans-serif';
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
        <span class="text-[17px] leading-[22px] font-[590] text-white">9:41</span>
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
        <div class="flex flex-col gap-6">
          <p class="text-2xl font-bold">Dashboard</p>
          <SummaryAndRefills
            count={state.vitaminDDone > 0.5 ? 4 : 3}
            overdue={1}
            overdueOpacity={1 - state.vitaminDDone}
          />
          <MyDaySection
            {slots}
            {timeFormat}
            done={{ "vitd09:05": state.vitaminDDone }}
            markPrefix="p."
            logMarks={{ "vitd09:05": "p.vitdLog" }}
          />
        </div>
      </div>
      <StageToast text="Vitamin D logged" progress={state.toast} bottom={42} />
    </div>

    <!-- Web Push as src/lib/server/reminders.ts sends it: "<name> overdue" -->
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
          <span class="text-[15px] leading-5 font-semibold">Vitamin D overdue</span>
          <span class="text-[13px] leading-[18px]" style:color="rgba(235,235,245,0.6)">now</span>
        </div>
        <div class="text-[15px] leading-5" style:color="rgba(255,255,255,0.92)">
          Last logged 1d ago
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
