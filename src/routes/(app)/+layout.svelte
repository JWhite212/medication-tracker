<script lang="ts">
  import { tick } from "svelte";
  import { afterNavigate } from "$app/navigation";
  import Sidebar from "$components/Sidebar.svelte";
  import MobileHeader from "$components/MobileHeader.svelte";
  import Toast from "$components/ui/Toast.svelte";
  import { readableForeground } from "$lib/utils/contrast";
  import { buildThemeStyle } from "$lib/appearance/theme-css";
  import { collectFocusable, trapTab } from "$lib/utils/focus-trap";

  let { data, children } = $props();
  let sidebarOpen = $state(false);

  /** Referenced by the toggle's aria-controls; the overlay is the only element carrying it. */
  const MOBILE_NAV_ID = "mobile-nav";
  let menuToggle: HTMLButtonElement | undefined = $state();
  let menuPanel: HTMLDivElement | undefined = $state();

  /**
   * The overlay is an aria-modal dialog, so opening it has to put focus inside
   * it. It used to open behind the user's focus: the toggle kept it, and Tab
   * walked on through the header and the page underneath the scrim.
   */
  async function openMenu() {
    sidebarOpen = true;
    await tick();
    if (menuPanel) collectFocusable(menuPanel)[0]?.focus();
  }

  /**
   * `returnFocus` is decided by WHY the menu closed, not by the fact that it
   * did. Escape and the scrim dismiss the menu in place, so focus goes back to
   * the toggle; without that the focused link is unmounted under it and focus
   * drops to <body>. Following a link is a navigation, and SvelteKit resets
   * focus itself once the new page renders, so pulling focus to the toggle
   * there would fight the router and strand a keyboard user in the header.
   *
   * The tick() is load-bearing: the toggle sits inside an `inert` subtree
   * while the menu is open, and focus() on an inert element silently does
   * nothing. The attribute is only removed once the DOM has caught up.
   */
  async function closeMenu(returnFocus: boolean) {
    if (!sidebarOpen) return;
    sidebarOpen = false;
    if (!returnFocus) return;
    await tick();
    menuToggle?.focus();
  }

  /**
   * On window rather than the overlay, for the reason ui/Modal gives: a
   * handler on the overlay only hears keys pressed while focus is already
   * inside it, which is exactly the state this handler exists to restore.
   */
  function handleMenuKeydown(e: KeyboardEvent) {
    if (!sidebarOpen) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    // Trapped in the panel, not the whole overlay: the scrim is the dimmed
    // backdrop itself, and a Tab stop on it would look like focus had vanished.
    // Keyboards close with Escape; the scrim stays inside the dialog, so screen
    // readers can still reach it.
    if (e.key === "Tab" && menuPanel) trapTab(menuPanel, e);
  }

  // Sidebar's own nav links close the menu on click, but its brand link does
  // not, and neither does a history navigation (a phone's back gesture). The
  // layout survives every in-app navigation, so without this the menu stayed
  // open over the next page. afterNavigate runs after SvelteKit has reset
  // focus, so closing here cannot undo that reset.
  afterNavigate(() => closeMenu(false));

  // The overlay is md:hidden but `sidebarOpen` does not know that. Rotating a
  // tablet past the breakpoint with the menu open would hide it while leaving
  // the header and main `inert` and the window Tab trap pointed at links that
  // can no longer take focus, which makes the whole desktop layout
  // unreachable by mouse and keyboard alike. 48rem is Tailwind's `md`.
  $effect(() => {
    if (!sidebarOpen) return;
    const desktop = window.matchMedia("(min-width: 48rem)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) closeMenu(false);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  });

  // No service worker registration here on purpose. SvelteKit registers
  // src/service-worker.ts app-wide (kit.serviceWorker.register defaults
  // to true), so registering a second script at the same scope from this
  // layout made the two evict each other on every load.

  // accent and accent-fg stay INLINE: both are scheme-independent (the fill
  // is the user's stored hex, and the foreground is derived from the fill
  // alone). accent-ink does NOT — it has to be re-derived per scheme, and an
  // inline style on this wrapper would outrank the theme block for the whole
  // subtree, which is the exact trap spec decision 4 was written to avoid.
  const accentColor = $derived(data.preferences.accentColor);
  const accentFgColor = $derived(readableForeground(accentColor).color);
  const themeStyle = $derived(buildThemeStyle(data.preferences.theme, accentColor));
</script>

<svelte:head>
  <meta name="robots" content="noindex, nofollow" />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html themeStyle}
</svelte:head>

<svelte:window onkeydown={handleMenuKeydown} />

<div
  style:--color-accent={accentColor}
  style:--color-accent-fg={accentFgColor}
  data-density={data.preferences.uiDensity}
  data-reduced-motion={data.preferences.reducedMotion ? "true" : "false"}
>
  <!-- The header and main go `inert` while the menu is open. aria-modal alone
       neither stops Tab nor is honoured by every screen reader, so without it
       the page behind the scrim stays reachable by swipe and virtual cursor.
       It cannot break closing: Escape is on window and the scrim sits outside
       both inert subtrees. The one cost is focus return, since the toggle is
       inside the header; closeMenu waits for the attribute to clear first.
       Toast is left out on purpose, because an inert live region is dropped
       from the accessibility tree and its alerts would go unannounced. -->
  <!-- Mobile header (below md) -->
  <div class="md:hidden" inert={sidebarOpen}>
    <MobileHeader
      user={data.user}
      menuOpen={sidebarOpen}
      menuId={MOBILE_NAV_ID}
      bind:toggle={menuToggle}
      ontoggle={() => (sidebarOpen ? closeMenu(true) : openMenu())}
    />
  </div>

  <!-- Mobile sidebar overlay -->
  {#if sidebarOpen}
    <div
      id={MOBILE_NAV_ID}
      class="fixed inset-0 z-30 md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation menu"
      tabindex="-1"
    >
      <button
        type="button"
        class="bg-scrim absolute inset-0"
        aria-label="Close navigation"
        onclick={() => closeMenu(true)}
      ></button>
      <!-- tabindex="-1" because trapTab focuses its container when nothing
           inside is tabbable; Sidebar always renders links, but the contract
           is the util's, not this call site's. -->
      <div bind:this={menuPanel} class="relative h-full w-64" tabindex="-1">
        <!-- Sidebar calls onclose only when one of its links is followed. -->
        <Sidebar user={data.user} mobile={true} onclose={() => closeMenu(false)} />
      </div>
    </div>
  {/if}

  <div class="flex h-screen overflow-hidden" inert={sidebarOpen}>
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
