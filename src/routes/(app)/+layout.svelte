<script lang="ts">
  import Sidebar from "$components/Sidebar.svelte";
  import MobileHeader from "$components/MobileHeader.svelte";
  import KeyboardShortcuts from "$components/KeyboardShortcuts.svelte";
  import type { SessionUser } from "$lib/types";

  let { data, children } = $props();
  let sidebarOpen = $state(false);

  function accentFg(hex: string): string {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const r = lin(parseInt(hex.slice(1, 3), 16));
    const g = lin(parseInt(hex.slice(3, 5), 16));
    const b = lin(parseInt(hex.slice(5, 7), 16));
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // WCAG contrast ratio: pick whichever (white or dark) has higher contrast
    const crWhite = 1.05 / (L + 0.05);
    const crDark = (L + 0.05) / (0.005 + 0.05);
    return crWhite >= crDark ? "#ffffff" : "#111111";
  }

  const accentColor = $derived(data.preferences.accentColor);
  const accentFgColor = $derived(accentFg(accentColor));
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div
  style:--color-accent={accentColor}
  style:--color-accent-fg={accentFgColor}
  data-density={data.preferences.uiDensity}
  data-reduced-motion={data.preferences.reducedMotion ? "true" : "false"}
>
  <!-- Mobile header (below md) -->
  <div class="md:hidden">
    <MobileHeader user={data.user} ontoggle={() => (sidebarOpen = !sidebarOpen)} />
  </div>

  <!-- Mobile sidebar overlay -->
  {#if sidebarOpen}
    <div
      class="fixed inset-0 z-30 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      tabindex="-1"
      onkeydown={(e) => e.key === "Escape" && (sidebarOpen = false)}
    >
      <button
        type="button"
        class="absolute inset-0 bg-black/60"
        aria-label="Close navigation"
        onclick={() => (sidebarOpen = false)}
      ></button>
      <div class="relative h-full w-64 transform transition-transform duration-200">
        <Sidebar user={data.user} mobile={true} onclose={() => (sidebarOpen = false)} />
      </div>
    </div>
  {/if}

  <div class="flex h-screen overflow-hidden">
    <!-- Desktop sidebar (md+) -->
    <div class="hidden md:flex">
      <Sidebar user={data.user} />
    </div>

    <main id="main-content" class="flex-1 overflow-y-auto p-4 pt-18 md:p-6 md:pt-6 lg:p-8">
      {@render children()}
    </main>
  </div>

  <KeyboardShortcuts />
</div>
