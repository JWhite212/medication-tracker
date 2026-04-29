<script lang="ts">
  import type { SessionUser } from "$lib/types";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";

  let { user, ontoggle }: { user: SessionUser; ontoggle: () => void } = $props();
</script>

<header
  class="border-glass-border bg-surface-raised fixed top-0 right-0 left-0 z-20 flex h-14 items-center justify-between border-b px-4"
>
  <button
    type="button"
    onclick={ontoggle}
    class="text-text-secondary hover:bg-glass-hover hover:text-text-primary flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
    aria-label="Toggle menu"
  >
    <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  </button>

  <a href="/dashboard" class="flex items-center gap-2 text-lg font-semibold">
    <img src={appIcon} alt="" width="28" height="28" class="h-7 w-7 rounded-md" />
    <span>MedTracker</span>
  </a>

  <a
    href="/settings"
    class="bg-accent/20 text-accent flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
  >
    {user.name.charAt(0).toUpperCase()}
  </a>
</header>
