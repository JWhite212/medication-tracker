<script lang="ts">
  import Sidebar from "$components/Sidebar.svelte";
  import MobileHeader from "$components/MobileHeader.svelte";
  import Toast from "$components/ui/Toast.svelte";
  import { readableForeground, readableInk } from "$lib/utils/contrast";

  let { data, children } = $props();
  let sidebarOpen = $state(false);

  // No service worker registration here on purpose. SvelteKit registers
  // src/service-worker.ts app-wide (kit.serviceWorker.register defaults
  // to true), so registering a second script at the same scope from this
  // layout made the two evict each other on every load.

  // These three travel together and are set inline, which beats every
  // stylesheet rule — the @theme values are only the logged-out fallback.
  // accent is the fill, accent-fg is what sits on top of it, and accent-ink
  // is the same hue lightened until it reads as text on the lightest surface.
  // A constant ink would leave 133 text/border/ring sites frozen at indigo
  // for a user who picked amber.
  const accentColor = $derived(data.preferences.accentColor);
  const accentFgColor = $derived(readableForeground(accentColor).color);
  const accentInkColor = $derived(readableInk(accentColor));
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div
  style:--color-accent={accentColor}
  style:--color-accent-fg={accentFgColor}
  style:--color-accent-ink={accentInkColor}
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
        class="bg-scrim absolute inset-0"
        aria-label="Close navigation"
        onclick={() => (sidebarOpen = false)}
      ></button>
      <div class="relative h-full w-64">
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

  <Toast />
</div>
