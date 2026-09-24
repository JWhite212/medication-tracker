<script lang="ts">
  // A simplified dark macOS Chrome window: traffic lights, one active tab and
  // the URL bar. Purely decorative; the page content goes in the slot.
  import type { Snippet } from "svelte";

  let {
    width,
    height,
    url,
    tabTitle,
    children,
  }: { width: number; height: number; url: string; tabTitle: string; children: Snippet } = $props();
</script>

<div
  class="flex flex-col overflow-hidden rounded-[10px] bg-[#35363a]"
  style:width="{width}px"
  style:height="{height}px"
  style:box-shadow="0 24px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.1)"
>
  <!-- Tab bar -->
  <div class="flex h-11 items-center bg-[#202124] pr-2">
    <div class="flex gap-2 px-3.5">
      <div class="h-3 w-3 rounded-full bg-[#ff5f57]"></div>
      <div class="h-3 w-3 rounded-full bg-[#febc2e]"></div>
      <div class="h-3 w-3 rounded-full bg-[#28c840]"></div>
    </div>
    <div class="flex h-full flex-1 items-end pl-1">
      <div
        class="relative flex h-[34px] max-w-[220px] min-w-[120px] items-center gap-2 self-end rounded-t-lg bg-[#35363a] px-3 font-[system-ui,sans-serif] text-xs text-[#e8eaed]"
      >
        <!-- The curved scoops either side of an active Chrome tab -->
        <svg width="8" height="10" viewBox="0 0 8 10" class="absolute bottom-0 -left-2">
          <path d="M0 10C2 9 6 8 8 0V10H0Z" fill="#35363a" />
        </svg>
        <svg
          width="8"
          height="10"
          viewBox="0 0 8 10"
          class="absolute -right-2 bottom-0"
          style:transform="scaleX(-1)"
        >
          <path d="M0 10C2 9 6 8 8 0V10H0Z" fill="#35363a" />
        </svg>
        <div class="h-3.5 w-3.5 shrink-0 rounded-full bg-[#5f6368]"></div>
        <span class="flex-1 truncate">{tabTitle}</span>
      </div>
    </div>
  </div>

  <!-- Toolbar -->
  <div class="flex h-10 items-center gap-1 bg-[#35363a] px-2">
    <div class="flex h-7 w-7 items-center justify-center">
      <div class="h-4 w-4 rounded-full bg-[#9aa0a6] opacity-40"></div>
    </div>
    <div class="mx-1.5 flex h-[30px] flex-1 items-center gap-2 rounded-[15px] bg-[#282a2d] px-3.5">
      <div class="h-3 w-3 rounded-full bg-[#9aa0a6] opacity-40"></div>
      <span class="flex-1 font-[system-ui,sans-serif] text-[13px] leading-normal text-[#e8eaed]"
        >{url}</span
      >
    </div>
    <div class="flex h-7 w-7 items-center justify-center">
      <div class="h-4 w-4 rounded-full bg-[#9aa0a6] opacity-40"></div>
    </div>
  </div>

  <div class="flex-1 overflow-hidden bg-white">
    {@render children()}
  </div>
</div>
