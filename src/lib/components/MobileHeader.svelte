<script lang="ts">
  import type { SessionUser } from '$lib/types';
  import appIcon from '$lib/assets/1974f178-4b4b-4da9-a561-26adec22d906.png';

  let { user, ontoggle }: { user: SessionUser; ontoggle: () => void } = $props();
</script>

<header class="fixed top-0 left-0 right-0 h-14 z-20 flex items-center justify-between border-b border-glass-border bg-surface-raised px-4">
  <button
    type="button"
    onclick={ontoggle}
    class="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
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
    class="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-xs font-medium text-accent"
  >
    {user.name.charAt(0).toUpperCase()}
  </a>
</header>
