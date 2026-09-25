<script lang="ts">
  import type { SideEffect } from "$lib/types";

  let { value = [], onchange }: { value: SideEffect[]; onchange: (effects: SideEffect[]) => void } =
    $props();

  const commonEffects = [
    "Nausea",
    "Headache",
    "Dizziness",
    "Drowsiness",
    "Dry mouth",
    "Fatigue",
    "Insomnia",
    "Appetite change",
  ];

  let customInput = $state("");
  // SSR-stable, so the label's `for` survives hydration. A literal id would
  // have to stay unique on every page that hosts the dose editor.
  const customInputId = $props.id();

  function isSelected(name: string): boolean {
    return value.some((e) => e.name === name);
  }

  function toggle(name: string) {
    if (isSelected(name)) {
      onchange(value.filter((e) => e.name !== name));
    } else {
      onchange([...value, { name, severity: "mild" }]);
    }
  }

  function setSeverity(name: string, severity: SideEffect["severity"]) {
    onchange(value.map((e) => (e.name === name ? { ...e, severity } : e)));
  }

  function addCustom() {
    const trimmed = customInput.trim();
    if (!trimmed || isSelected(trimmed)) return;
    onchange([...value, { name: trimmed, severity: "mild" }]);
    customInput = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustom();
    }
  }

  const severityOptions: Array<{ value: SideEffect["severity"]; label: string }> = [
    { value: "mild", label: "Mild" },
    { value: "moderate", label: "Mod" },
    { value: "severe", label: "Severe" },
  ];

  let customEffects = $derived(value.filter((e) => !commonEffects.includes(e.name)));
</script>

<!-- A fieldset, not a div with a span heading, so the chips, the text field and
     the severity buttons are announced as one "Side Effects" group. `min-w-0`
     undoes the fieldset's min-content width, which the div never had. -->
<fieldset class="m-0 min-w-0 space-y-3 border-0 p-0">
  <legend class="block text-sm font-medium">Side Effects</legend>

  <!-- Common effect chips -->
  <div class="flex flex-wrap gap-2">
    {#each commonEffects as name}
      <!-- Selection was carried by border and background alone. -->
      <button
        type="button"
        onclick={() => toggle(name)}
        aria-pressed={isSelected(name)}
        class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors {isSelected(name)
          ? 'border-accent-ink bg-accent/15 text-accent-ink'
          : 'border-border-strong bg-glass text-text-secondary hover:bg-glass-hover'}"
      >
        {name}
      </button>
    {/each}

    <!-- Custom effect chips -->
    <!-- These are not toggles: a custom effect has no unselected state to
         return to, so pressing one deletes it. Named by what the press does,
         with the effect's own name kept in the accessible name so voice
         control still reaches it by what is on screen. -->
    {#each customEffects as effect}
      <button
        type="button"
        onclick={() => toggle(effect.name)}
        aria-label="Remove {effect.name}"
        class="border-accent-ink bg-accent/15 text-accent-ink inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
      >
        {effect.name}
        <span aria-hidden="true">&times;</span>
      </button>
    {/each}
  </div>

  <!-- Custom input -->
  <div>
    <!-- The placeholder was the field's only name, and it vanishes as soon as
         anything is typed. -->
    <label for={customInputId} class="text-text-muted mb-1 block text-xs">Other side effect</label>
    <div class="flex gap-2">
      <input
        id={customInputId}
        type="text"
        bind:value={customInput}
        onkeydown={handleKeydown}
        placeholder="Add custom effect..."
        class="border-border-strong bg-surface text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink flex-1 rounded-lg border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
      />
      <button
        type="button"
        onclick={addCustom}
        disabled={!customInput.trim()}
        class="border-border-strong bg-glass text-text-secondary hover:bg-glass-hover rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
      >
        Add
      </button>
    </div>
  </div>

  <!-- Severity selectors for selected effects -->
  {#if value.length > 0}
    <div class="space-y-2">
      {#each value as effect}
        <div
          class="border-glass-border bg-glass flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
        >
          <span class="text-sm">{effect.name}</span>
          <div class="flex gap-1">
            {#each severityOptions as opt}
              <!-- The only difference between selected and unselected here is
                   background colour, and the three severities are themselves
                   distinguished by colour — so without aria-pressed the current
                   severity is unavailable to assistive tech and to anyone who
                   cannot separate amber from red. -->
              <button
                type="button"
                onclick={() => setSeverity(effect.name, opt.value)}
                aria-pressed={effect.severity === opt.value}
                aria-label="{opt.label} severity for {effect.name}"
                class="min-h-6 rounded-xs px-2 py-0.5 text-xs font-medium transition-colors {effect.severity ===
                opt.value
                  ? opt.value === 'mild'
                    ? 'bg-text-secondary/30 text-text-primary'
                    : opt.value === 'moderate'
                      ? 'bg-warning/20 text-warning'
                      : 'bg-danger/20 text-danger-ink'
                  : 'text-text-muted hover:text-text-secondary'}"
              >
                {opt.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</fieldset>
