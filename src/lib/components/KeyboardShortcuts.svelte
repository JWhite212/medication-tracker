<script lang="ts">
  let { medications = [] }: { medications?: Array<{ id: string; name: string }> } = $props();

  let showHelp = $state(false);

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if ((el as HTMLElement).contentEditable === 'true') return true;
    return false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return;

    if (e.key === '?') {
      e.preventDefault();
      showHelp = !showHelp;
      return;
    }

    if (showHelp && e.key === 'Escape') {
      e.preventDefault();
      showHelp = false;
      return;
    }

    if (e.key === 'n') {
      e.preventDefault();
      window.location.href = '/medications/new';
      return;
    }

    if (e.key === '/') {
      e.preventDefault();
      const input = document.querySelector<HTMLInputElement | HTMLSelectElement>(
        'select, input[type="date"], input[type="text"], input[type="search"]'
      );
      if (input) input.focus();
      return;
    }

    const num = parseInt(e.key);
    if (num >= 1 && num <= 9 && medications.length > 0) {
      const idx = num - 1;
      if (idx < medications.length) {
        e.preventDefault();
        const forms = document.querySelectorAll<HTMLFormElement>('form[action="?/logDose"]');
        const form = forms[idx];
        if (form) form.requestSubmit();
      }
    }
  }

  const shortcuts = [
    { keys: ['1-9'], description: 'Quick-log medication by position' },
    { keys: ['n'], description: 'Add new medication' },
    { keys: ['/'], description: 'Focus first filter input' },
    { keys: ['?'], description: 'Toggle this help overlay' },
    { keys: ['Esc'], description: 'Close this overlay' },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

{#if showHelp}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={(e) => { if (e.target === e.currentTarget) showHelp = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showHelp = false; }}
    role="dialog"
    aria-modal="true"
    aria-label="Keyboard shortcuts"
    tabindex="-1"
  >
    <div class="w-full max-w-sm rounded-xl border border-glass-border bg-surface-raised p-6 shadow-2xl">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold text-text-primary">Keyboard Shortcuts</h2>
        <button
          onclick={() => (showHelp = false)}
          class="rounded-lg p-1 text-text-muted hover:text-text-secondary"
          aria-label="Close"
        >
          <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div class="space-y-3">
        {#each shortcuts as shortcut}
          <div class="flex items-center justify-between">
            <span class="text-sm text-text-secondary">{shortcut.description}</span>
            <div class="flex gap-1">
              {#each shortcut.keys as key}
                <kbd class="rounded-md border border-glass-border bg-glass px-2 py-1 font-mono text-xs text-text-primary">{key}</kbd>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
