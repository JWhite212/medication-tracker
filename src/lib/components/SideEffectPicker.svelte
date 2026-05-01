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

<div class="space-y-3">
  <span class="block text-sm font-medium">Side Effects</span>

  <!-- Common effect chips -->
  <div class="flex flex-wrap gap-2">
    {#each commonEffects as name}
      <button
        type="button"
        onclick={() => toggle(name)}
        class="rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors {isSelected(name)
          ? 'border-accent bg-accent/15 text-accent-hover'
          : 'border-glass-border bg-glass text-text-secondary hover:bg-glass-hover'}"
      >
        {name}
      </button>
    {/each}

    <!-- Custom effect chips -->
    {#each customEffects as effect}
      <button
        type="button"
        onclick={() => toggle(effect.name)}
        class="border-accent bg-accent/15 text-accent-hover rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
      >
        {effect.name}
      </button>
    {/each}
  </div>

  <!-- Custom input -->
  <div class="flex gap-2">
    <input
      type="text"
      bind:value={customInput}
      onkeydown={handleKeydown}
      placeholder="Add custom effect..."
      class="border-glass-border bg-surface text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent flex-1 rounded-lg border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
    />
    <button
      type="button"
      onclick={addCustom}
      disabled={!customInput.trim()}
      class="border-glass-border bg-glass text-text-secondary hover:bg-glass-hover rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40"
    >
      Add
    </button>
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
              <button
                type="button"
                onclick={() => setSeverity(effect.name, opt.value)}
                class="rounded px-2 py-0.5 text-xs font-medium transition-colors {effect.severity ===
                opt.value
                  ? opt.value === 'mild'
                    ? 'bg-text-secondary/30 text-text-primary'
                    : opt.value === 'moderate'
                      ? 'bg-warning/20 text-warning'
                      : 'bg-danger/20 text-danger'
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
</div>
