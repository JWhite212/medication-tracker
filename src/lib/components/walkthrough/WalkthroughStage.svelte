<script lang="ts">
  // One 1920x1080 frame of the walkthrough. Everything shown is a function of
  // `frame` (from computeFrame), so the parent only has to move time along.
  //
  // `full` is false for the prerendered first paint: only the title card is
  // rendered, and the heavier desktop and phone layers mount once the player
  // is on screen in the browser.
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import { DISCLAIMER_TEXT } from "$components/MedicalDisclaimer.svelte";
  import type { TimeFormat } from "$lib/utils/time";
  import { PAGES, SITE_HOST } from "./demo-data";
  import { STAGE_H, STAGE_W, WIN_H, WIN_W, activeCaption, type Frame } from "./timeline";
  import AppShell from "./parts/AppShell.svelte";
  import ChromeWindow from "./parts/ChromeWindow.svelte";
  import StageToast from "./parts/StageToast.svelte";
  import AddMedicationScene from "./scenes/AddMedicationScene.svelte";
  import AnalyticsScene from "./scenes/AnalyticsScene.svelte";
  import DashboardScene from "./scenes/DashboardScene.svelte";
  import DataScene from "./scenes/DataScene.svelte";
  import HistoryScene from "./scenes/HistoryScene.svelte";
  import MedicationsScene from "./scenes/MedicationsScene.svelte";
  import PhoneScene from "./scenes/PhoneScene.svelte";
  import SecurityScene from "./scenes/SecurityScene.svelte";
  import { useMark } from "./marks";

  let {
    frame,
    time,
    full,
    timeFormat,
  }: { frame: Frame; time: number; full: boolean; timeFormat: TimeFormat } = $props();

  const mark = useMark();
  // The stage point shots centre on; must match CX/CY in timeline.ts.
  const CX = 960;
  const CY = 421;

  const page = $derived(PAGES[frame.page]);
  const caption = $derived(activeCaption(time));
  const camera = $derived(frame.camera);
</script>

<div
  class="bg-surface text-text-primary absolute top-0 left-0 overflow-hidden font-sans"
  style:width="{STAGE_W}px"
  style:height="{STAGE_H}px"
>
  {#if full}
    <!-- Desktop: the app in a browser window, framed by the camera -->
    <div class="absolute inset-0" style:visibility={frame.kind === "desk" ? "visible" : "hidden"}>
      <div
        class="absolute top-0 left-0 origin-top-left"
        style:width="{WIN_W}px"
        style:height="{WIN_H}px"
        style:transform="translate({CX - camera.x * camera.s}px, {CY - camera.y * camera.s}px)
        scale({camera.s})"
      >
        <div class="shadow-accent/10 rounded-[10px] shadow-2xl">
          <ChromeWindow
            width={WIN_W}
            height={WIN_H}
            url="{SITE_HOST}{page.url}"
            tabTitle={page.title}
          >
            <AppShell active={page.nav}>
              {#snippet overlay()}
                <StageToast text="Lisinopril logged" progress={frame.toast} markKey="o.toast" />
              {/snippet}
              <!-- Every page stays mounted so its elements can be measured up front -->
              <div
                use:mark={"d.page"}
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "dash" ? "inherit" : "hidden"}
                style:transform={frame.page === "dash" && frame.scroll
                  ? `translateY(${-frame.scroll}px)`
                  : undefined}
              >
                <DashboardScene state={frame.dashboard} {timeFormat} />
              </div>
              <div
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "meds" ? "inherit" : "hidden"}
              >
                <MedicationsScene load={frame.medicationsLoad} tick={frame.tick} />
              </div>
              <div
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "add" ? "inherit" : "hidden"}
              >
                <AddMedicationScene state={frame.addForm} />
              </div>
              <div
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "log" ? "inherit" : "hidden"}
              >
                <HistoryScene
                  checked={frame.history.checked}
                  filtered={frame.history.filtered}
                  {timeFormat}
                />
              </div>
              <div
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "ana" ? "inherit" : "hidden"}
              >
                <AnalyticsScene load={frame.analyticsLoad} heat={frame.heat} />
              </div>
              <div
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "sec" ? "inherit" : "hidden"}
              >
                <SecurityScene />
              </div>
              <div
                class="absolute top-0 left-0 w-full p-8"
                style:visibility={frame.page === "data" ? "inherit" : "hidden"}
              >
                <DataScene hover={frame.downloadHover} />
              </div>
            </AppShell>
          </ChromeWindow>
        </div>

        {#if frame.cursor}
          {@const cursor = frame.cursor}
          {#if cursor.ripple}
            <div
              class="absolute h-11 w-11 rounded-full border-2"
              style:left="{cursor.ripple.x - 22}px"
              style:top="{cursor.ripple.y - 22}px"
              style:border-color="rgba(255,255,255,0.75)"
              style:opacity={(1 - cursor.ripple.p) * 0.8}
              style:transform="scale({0.3 + 0.9 * cursor.ripple.p})"
            ></div>
          {/if}
          <svg
            width="24"
            height="32"
            viewBox="0 0 24 32"
            class="absolute overflow-visible"
            style:left="{cursor.x - 3}px"
            style:top="{cursor.y - 2}px"
            style:transform="scale({1 - 0.12 * cursor.press})"
            style:transform-origin="3px 2px"
            style:filter="drop-shadow(0 2px 4px rgba(0,0,0,0.45))"
          >
            <path
              d="M3 2 L3 25 L8.6 19.6 L12.4 28.4 L16 26.8 L12.3 18.3 L20 18.3 Z"
              fill="#ffffff"
              stroke="#111111"
              stroke-width="1.5"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      </div>
    </div>

    <!-- Phone -->
    <div class="absolute inset-0" style:visibility={frame.kind === "phone" ? "visible" : "hidden"}>
      <div
        class="absolute h-[874px] w-[402px]"
        style:left="{1330 - 201}px"
        style:top="{540 - 437}px"
        style:transform="scale({frame.phone.scale})"
      >
        <PhoneScene state={frame.phone} {timeFormat} />
      </div>
    </div>
  {/if}

  <!-- Title card; the outro returns to it so the loop is seamless -->
  <div class="absolute inset-0" style:visibility={frame.kind === "title" ? "visible" : "hidden"}>
    <div
      class="absolute inset-0 flex flex-col items-center justify-center gap-10"
      style:transform="scale({frame.titleScale})"
    >
      <img src={appIcon} alt="" width="160" height="160" class="block h-40 w-40" />
      <p class="text-[80px] leading-[1.1] font-bold tracking-tight whitespace-nowrap">
        Track your medications <span class="text-accent-ink">effortlessly</span>
      </p>
    </div>
    <div
      class="absolute right-0 bottom-[72px] left-0 flex flex-col items-center gap-[18px]"
      style:opacity={frame.outroExtras}
    >
      <span class="text-text-secondary text-[30px] leading-10 font-medium">{SITE_HOST}</span>
      <p class="text-text-muted max-w-[1240px] text-center text-[22px] leading-8">
        {DISCLAIMER_TEXT}
      </p>
    </div>
  </div>

  <!-- Lower third -->
  {#if caption}
    <div
      class="pointer-events-none absolute bottom-16 left-[72px] text-left"
      style:opacity={caption.opacity}
    >
      <div
        class="border-glass-border flex max-w-[940px] flex-col items-start gap-3.5 rounded-xl border px-7 pt-[22px] pb-6"
        style:background="rgba(18,18,26,0.94)"
      >
        <div
          class="text-text-muted flex items-center gap-3 text-lg leading-6 font-semibold tracking-[0.08em] uppercase"
        >
          <span class="text-accent-ink tabular-nums">{caption.item.number}</span><span
            >{caption.item.title}</span
          >
        </div>
        <div class="text-[40px] leading-[48px] font-semibold tracking-[-0.015em] text-pretty">
          {caption.item.line}
        </div>
        <div
          class="border-glass-border bg-glass text-text-secondary flex items-center gap-2.5 rounded-full border py-2 pr-4 pl-3 text-[22px] leading-[30px] whitespace-nowrap"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-accent-ink)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg
          >
          <span>{caption.item.tech}</span>
        </div>
      </div>
    </div>
  {/if}
</div>
