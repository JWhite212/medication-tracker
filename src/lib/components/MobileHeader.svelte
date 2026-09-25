<script lang="ts">
  import type { SessionUser } from "$lib/types";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";

  let {
    user,
    menuOpen,
    menuId,
    toggle = $bindable(),
    ontoggle,
  }: {
    user: SessionUser;
    menuOpen: boolean;
    /** The id of the overlay this button opens, for aria-controls. */
    menuId: string;
    /** Bound by the layout so closing the menu can hand focus back here. */
    toggle?: HTMLButtonElement;
    ontoggle: () => void;
  } = $props();
</script>

<header
  class="border-glass-border bg-surface-raised fixed top-0 right-0 left-0 z-20 flex h-14 items-center justify-between border-b px-4"
>
  <!-- aria-controls is emitted only while the menu is open, because the
       overlay it names is unmounted while closed and an IDREF must point at
       an element that exists. aria-expanded="false" already tells AT there is
       nothing to go to in that state. -->
  <button
    bind:this={toggle}
    type="button"
    onclick={ontoggle}
    class="text-text-secondary hover:bg-surface-overlay hover:text-text-primary flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
    aria-label="Toggle menu"
    aria-expanded={menuOpen}
    aria-controls={menuOpen ? menuId : undefined}
  >
    <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  </button>

  <a href="/dashboard" class="flex items-center gap-2 text-lg font-semibold">
    <img src={appIcon} alt="" width="28" height="28" class="h-7 w-7 rounded-md" />
    <span>MedTracker</span>
  </a>

  <!-- The initial is the only visible content, so on its own it made the
       link's accessible name a single letter that says nothing about where it
       goes. It is hidden from AT and the destination is named instead. -->
  <a
    href="/settings"
    class="bg-accent/15 text-accent-ink flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
  >
    <span class="sr-only">Account settings</span>
    <span aria-hidden="true">{user.name.charAt(0).toUpperCase()}</span>
  </a>
</header>
