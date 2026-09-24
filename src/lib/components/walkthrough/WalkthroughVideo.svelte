<script lang="ts">
  // The landing-page product walkthrough: a 43.5-second, 16:9 loop through ten
  // features, drawn live from Svelte components rather than shipped as a video
  // file. It stays crisp at any size, weighs a few KB, and changes with the UI
  // it depicts.
  //
  // The player owns time and nothing else. It advances one number with
  // requestAnimationFrame, and computeFrame() turns that number into every
  // position, fade and cursor on screen. It pauses when scrolled out of view
  // or when the tab is hidden, never autoplays for anyone who prefers reduced
  // motion, and always offers a pause button (WCAG 2.2.2).
  import { onMount, tick, untrack } from "svelte";
  import { DARK_TOKENS, accentInkFor } from "$lib/appearance/theme-css";
  import { readableForeground } from "$lib/utils/contrast";
  import type { TimeFormat } from "$lib/utils/time";
  import { LOWER_THIRDS, STAGE_H, STAGE_W, TOTAL_DURATION, computeFrame } from "./timeline";
  import type { Measurements } from "./timeline";
  import { createMarkRegistry, measureMarks, provideMarks } from "./marks";
  import WalkthroughStage from "./WalkthroughStage.svelte";

  let {
    // The app's default accent, so the video matches what a new account sees.
    accent = "#6366f1",
    timeFormat = "24h",
  }: { accent?: string; timeFormat?: TimeFormat } = $props();

  const registry = createMarkRegistry();
  provideMarks(registry);

  let time = $state(0);
  let playing = $state(false);
  // False until mounted in the browser; the prerendered HTML carries only the
  // title card.
  let full = $state(false);
  let measurements = $state<Measurements>({});
  let containerWidth = $state(0);
  let inView = $state(false);
  let pageVisible = $state(true);

  const scale = $derived(containerWidth / STAGE_W);
  const frame = $derived(computeFrame(time, measurements));
  const running = $derived(playing && inView && pageVisible);

  // The video is always dark, like the app's default, whatever scheme the
  // landing page itself is in. Pinning the tokens on the root means every
  // Tailwind colour utility inside resolves to the dark palette and the chosen
  // accent, derived exactly as the (app) layout derives them.
  const themeStyle = $derived(
    [
      ...Object.entries(DARK_TOKENS).map(([name, value]) => `${name}: ${value}`),
      `--color-accent: ${accent}`,
      `--color-accent-fg: ${readableForeground(accent).color}`,
      `--color-accent-ink: ${accentInkFor("dark", accent)}`,
      "color-scheme: dark",
    ].join("; "),
  );

  let root: HTMLElement;

  function remeasure() {
    const next = measureMarks(registry);
    // Only replace the object when something moved, so a no-op remeasure does
    // not invalidate every derived value on the next frame.
    if (JSON.stringify(next) !== JSON.stringify(measurements)) measurements = next;
  }

  // Wall-clock origin of the current play-through. Time is recovered from it
  // on each frame rather than accumulated, so a dropped frame cannot drift
  // the loop.
  let origin = 0;
  $effect(() => {
    if (!running) return;
    // untrack: this effect must restart on play/pause, not on every frame.
    origin = performance.now() - untrack(() => time) * 1000;
    let handle = requestAnimationFrame(function step(now) {
      time = ((now - origin) / 1000) % TOTAL_DURATION;
      handle = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(handle);
  });

  onMount(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    playing = !reducedMotion;
    pageVisible = document.visibilityState === "visible";

    const onVisibility = () => {
      pageVisible = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", onVisibility);

    const observer = new IntersectionObserver(
      (entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        // Mount the full stage the first time it comes near the viewport.
        if (inView && !full) full = true;
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  // Measure once the full stage exists, then again as late layout settles:
  // system fonts can swap metrics after first paint.
  $effect(() => {
    if (!full) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    tick().then(() => {
      if (cancelled) return;
      remeasure();
      timers.push(setTimeout(remeasure, 300), setTimeout(remeasure, 1200));
      // A rejected fonts.ready is not worth reporting: the timed remeasures
      // above already cover late layout, and tests/unit/server-log.test.ts
      // keeps console calls out of client components.
      const remeasureUnlessCancelled = () => {
        if (!cancelled) remeasure();
      };
      document.fonts?.ready.then(remeasureUnlessCancelled, remeasureUnlessCancelled);
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  });

  function togglePlayback() {
    playing = !playing;
  }
</script>

<figure class="m-0">
  <div
    bind:this={root}
    bind:clientWidth={containerWidth}
    class="border-glass-border relative aspect-video w-full overflow-hidden rounded-2xl border bg-[#0a0a0f] shadow-2xl"
    style={themeStyle}
  >
    <!-- Decorative: the list below carries the same content for assistive tech -->
    <div
      aria-hidden="true"
      class="absolute top-0 left-0 origin-top-left select-none"
      style:width="{STAGE_W}px"
      style:height="{STAGE_H}px"
      style:transform="scale({scale})"
      style:visibility={containerWidth > 0 ? "visible" : "hidden"}
    >
      <WalkthroughStage {frame} {time} {full} {timeFormat} />
    </div>

    <div class="absolute top-2 right-2 flex items-center gap-3 sm:top-4 sm:right-4">
      <button
        type="button"
        onclick={togglePlayback}
        class="bg-surface-raised/85 text-text-primary border-border-strong focus-visible:outline-accent-ink flex h-8 w-8 items-center justify-center rounded-full border backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2 sm:h-10 sm:w-10"
        aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}
      >
        {#if playing}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <rect x="3" y="2" width="3.5" height="12" rx="1" />
            <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path
              d="M4 2.5v11a1 1 0 0 0 1.52.85l8.8-5.5a1 1 0 0 0 0-1.7l-8.8-5.5A1 1 0 0 0 4 2.5Z"
            />
          </svg>
        {/if}
      </button>
    </div>

    <!-- Progress through the loop -->
    <div class="bg-glass absolute right-0 bottom-0 left-0 h-1" aria-hidden="true">
      <div class="bg-accent h-full" style:width="{(time / TOTAL_DURATION) * 100}%"></div>
    </div>
  </div>

  <figcaption class="sr-only">
    <p>A walkthrough of MedTracker, showing:</p>
    <ol>
      {#each LOWER_THIRDS as item (item.number)}
        <li>{item.title}: {item.line}</li>
      {/each}
    </ol>
  </figcaption>
</figure>
