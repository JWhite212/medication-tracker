<script lang="ts">
  import type { SessionUser } from "$lib/types";
  import { page } from "$app/stores";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";

  let {
    user,
    mobile = false,
    onclose,
    ondismiss,
  }: {
    user: SessionUser;
    mobile?: boolean;
    /** A link was followed, so the page is about to change under the menu. */
    onclose?: () => void;
    /**
     * The close button was pressed and nothing else is happening. Kept apart
     * from `onclose` because the layout returns focus to the toggle for this
     * one and must not for that one, where the router owns focus.
     */
    ondismiss?: () => void;
  } = $props();

  /**
   * A modified click (Ctrl or Cmd for a new tab, Shift for a window, Alt to
   * download) leaves this page where it is; SvelteKit does not route it
   * either. Closing the menu then would only unmount the link the user is
   * still focused on and drop focus to <body>.
   */
  function closeOnFollow(e: MouseEvent) {
    if (!mobile || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    onclose?.();
  }

  const navItems = [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    },
    {
      href: "/medications",
      label: "Medications",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>',
    },
    {
      href: "/log",
      label: "History",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/></svg>',
    },
    {
      href: "/analytics",
      label: "Analytics",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/></svg>',
    },
    {
      href: "/settings",
      label: "Settings",
      icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
    },
  ];
</script>

<aside class="border-glass-border bg-surface-raised flex h-screen w-64 flex-col border-r">
  <!-- The close button is for the mobile menu, where the header's toggle is
       inert and the scrim sits outside the Tab trap, so otherwise Escape is
       the only keyboard exit and nothing on screen says so. It follows the
       brand link in the DOM so opening still lands focus on the first link.
       On desktop the link fills the row exactly as it did on its own. -->
  <div class="border-glass-border flex items-center border-b">
    <a
      href="/dashboard"
      class="hover:bg-surface-overlay flex min-w-0 flex-1 items-center gap-3 p-5 transition-colors"
    >
      <img src={appIcon} alt="" width="36" height="36" class="h-9 w-9 rounded-lg" />
      <span class="text-lg font-semibold">MedTracker</span>
    </a>
    {#if mobile && ondismiss}
      <button
        type="button"
        onclick={ondismiss}
        class="text-text-secondary hover:bg-surface-overlay hover:text-text-primary mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors"
        aria-label="Close menu"
      >
        <svg
          class="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    {/if}
  </div>
  <nav class="flex-1 space-y-1 p-3">
    {#each navItems as item}
      {@const active = $page.url.pathname.startsWith(item.href)}
      <a
        href={item.href}
        class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors {active
          ? 'bg-accent/15 text-accent-ink'
          : 'text-text-secondary hover:bg-surface-overlay hover:text-text-primary'}"
        aria-current={active ? "page" : undefined}
        onclick={closeOnFollow}
      >
        <span class="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true"
          >{@html item.icon}</span
        >
        {item.label}
      </a>
    {/each}
  </nav>
  <div class="border-glass-border border-t p-4">
    <!-- Same fix as MobileHeader's avatar link: the initial is decoration and
         read as a stray letter, and the name and email say who, not where.
         The destination goes LAST so the accessible name still starts with
         the visible text, which is what speech-input users will say. -->
    <a
      href="/settings"
      class="hover:bg-surface-overlay flex items-center gap-3 rounded-lg p-1 transition-colors"
      onclick={closeOnFollow}
    >
      <div
        class="bg-accent/15 text-accent-ink flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
        aria-hidden="true"
      >
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium">{user.name}</p>
        <p class="text-text-muted truncate text-xs">{user.email}</p>
      </div>
      <span class="sr-only">Account settings</span>
    </a>
  </div>
</aside>
