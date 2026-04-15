<script lang="ts">
  import Sidebar from '$components/Sidebar.svelte';
  import MobileHeader from '$components/MobileHeader.svelte';
  import type { SessionUser } from '$lib/types';

  let { data, children } = $props();
  let sidebarOpen = $state(false);
</script>

<!-- Mobile header (below md) -->
<div class="md:hidden">
  <MobileHeader user={data.user} ontoggle={() => (sidebarOpen = !sidebarOpen)} />
</div>

<!-- Mobile sidebar overlay -->
{#if sidebarOpen}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-30 md:hidden" onkeydown={(e) => e.key === 'Escape' && (sidebarOpen = false)}>
    <button
      type="button"
      class="absolute inset-0 bg-black/60"
      aria-label="Close sidebar"
      onclick={() => (sidebarOpen = false)}
    ></button>
    <div class="relative h-full w-64 transform transition-transform duration-200">
      <Sidebar user={data.user} mobile={true} onclose={() => (sidebarOpen = false)} />
    </div>
  </div>
{/if}

<div
  class="flex h-screen overflow-hidden"
  style:--color-accent={data.preferences.accentColor}
  data-density={data.preferences.uiDensity}
>
  <!-- Desktop sidebar (md+) -->
  <div class="hidden md:flex">
    <Sidebar user={data.user} />
  </div>

  <main class="flex-1 overflow-y-auto p-4 pt-18 md:p-6 md:pt-6 lg:p-8">
    {@render children()}
  </main>
</div>
