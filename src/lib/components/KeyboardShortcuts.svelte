<script lang="ts">
  import { tick } from "svelte";
  import { goto } from "$app/navigation";

  let { medications = [] }: { medications?: Array<{ id: string; name: string }> } = $props();

  let showHelp = $state(false);
  let helpEl: HTMLDivElement | undefined = $state();

  /**
   * Any focused control, not just text entry.
   *
   * The old check exempted input/textarea/select only, so pressing "n" while a
   * BUTTON had focus navigated away mid-task — and screen-reader users pass
   * single letters through constantly in browse mode. Scoping the shortcuts to
   * "nothing interactive is focused" is what WCAG 2.1.4 calls active-on-focus.
   */
  function isControlFocused(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    return !!el.closest(
      'input, textarea, select, button, a[href], [role="button"], [tabindex]:not([tabindex="-1"])',
    );
  }

  /** Handle unmodified global shortcuts when focus is outside an interactive control. */
  function handleKeydown(e: KeyboardEvent) {
    // Without this, every shortcut below fires with a modifier held and calls
    // preventDefault: Cmd/Ctrl+N was swallowed and turned into an in-page
    // navigation instead of opening a browser window, and Cmd+1..9 (tab
    // switching) and Cmd+/ went the same way.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isControlFocused()) return;

    if (e.key === "?") {
      e.preventDefault();
      showHelp = !showHelp;
      return;
    }

    if (showHelp && e.key === "Escape") {
      e.preventDefault();
      showHelp = false;
      return;
    }

    if (e.key === "n") {
      e.preventDefault();
      // goto, not location.href: a full document reload discards the client
      // router and costs a cold server render for an in-app navigation.
      goto("/medications/new");
      return;
    }

    if (e.key === "/") {
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(
        'select, input[type="date"], input[type="text"], input[type="search"]',
      );
      if (input) input.focus();
      return;
    }

    const num = parseInt(e.key);
    if (num >= 1 && num <= 9 && medications.length > 0) {
      const idx = num - 1;
      if (idx < medications.length) {
        e.preventDefault();
        // Match on the medication id rather than the form's position in the DOM.
        // The dashboard renders logDose forms in more than one section, so the
        // Nth form is not reliably the Nth medication — positional coupling could
        // log the wrong medication, which for a dosing control is the worst
        // available failure.
        const wanted = medications[idx].id;
        const form = [
          ...document.querySelectorAll<HTMLFormElement>('form[action="?/logDose"]'),
        ].find(
          (f) => f.querySelector<HTMLInputElement>('input[name="medicationId"]')?.value === wanted,
        );
        if (form) form.requestSubmit();
      }
    }
  }

  // The overlay is an aria-modal dialog; without this it opened behind the
  // user's focus, exactly as ui/Modal did.
  $effect(() => {
    if (showHelp) tick().then(() => helpEl?.querySelector("button")?.focus());
  });

  const shortcuts = [
    { keys: ["1-9"], description: "Quick-log medication by position" },
    { keys: ["n"], description: "Add new medication" },
    { keys: ["/"], description: "Focus first filter input" },
    { keys: ["?"], description: "Toggle this help overlay" },
    { keys: ["Esc"], description: "Close this overlay" },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if showHelp}
  <div
    class="bg-scrim fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
    onclick={(e) => {
      if (e.target === e.currentTarget) showHelp = false;
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") showHelp = false;
    }}
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    tabindex="-1"
  >
    <div
      bind:this={helpEl}
      class="border-glass-border bg-surface-raised w-full max-w-sm rounded-xl border p-6 shadow-2xl"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-text-primary text-lg font-semibold">Keyboard Shortcuts</h2>
        <button
          onclick={() => (showHelp = false)}
          class="text-text-muted hover:text-text-secondary rounded-lg p-1"
          aria-label="Close"
        >
          <svg
            class="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="space-y-3">
        {#each shortcuts as shortcut}
          <div class="flex items-center justify-between">
            <span class="text-text-secondary text-sm">{shortcut.description}</span>
            <div class="flex gap-1">
              {#each shortcut.keys as key}
                <kbd
                  class="border-glass-border bg-glass text-text-primary rounded-md border px-2 py-1 font-mono text-xs"
                  >{key}</kbd
                >
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
