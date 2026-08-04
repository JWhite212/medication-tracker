<script lang="ts">
  type MedOption = { id: string; name: string; colour: string; isArchived: boolean };

  let {
    medications,
    selectedIds,
    onchange,
  }: {
    medications: MedOption[];
    selectedIds: string[];
    onchange: (ids: string[]) => void;
  } = $props();

  let open = $state(false);
  let container: HTMLDivElement | undefined = $state();
  // Writable derived: checkboxes react instantly on toggle, then the
  // value resets to the server-confirmed selection when the filtered
  // page data lands.
  let selected = $derived([...selectedIds]);

  const label = $derived(
    selected.length === 0
      ? "All medications"
      : selected.length === 1
        ? (medications.find((m) => m.id === selected[0])?.name ?? "1 medication")
        : `${selected.length} medications`,
  );

  function toggle(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onchange(selected);
  }

  function clear() {
    selected = [];
    onchange(selected);
  }

  function onPointerDown(e: PointerEvent) {
    if (open && container && !container.contains(e.target as Node)) open = false;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") open = false;
  }
</script>

<svelte:window onpointerdown={onPointerDown} onkeydown={onKeyDown} />

<div class="relative" bind:this={container}>
  <button
    type="button"
    class="border-glass-border bg-glass text-text-primary flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium backdrop-blur-xl transition-colors {selected.length >
    0
      ? 'border-accent/60'
      : ''}"
    aria-expanded={open}
    aria-haspopup="true"
    onclick={() => (open = !open)}
  >
    <span class="max-w-40 truncate">{label}</span>
    <svg
      class="text-text-secondary h-3.5 w-3.5 shrink-0 transition-transform {open
        ? 'rotate-180'
        : ''}"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fill-rule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
        clip-rule="evenodd"
      />
    </svg>
  </button>

  {#if open}
    <div
      class="border-glass-border bg-surface-raised absolute right-0 z-20 mt-2 max-h-72 w-64 overflow-y-auto rounded-lg border p-1.5 shadow-xl"
      role="group"
      aria-label="Filter analytics by medication"
    >
      {#each medications as med (med.id)}
        <label
          class="hover:bg-surface-overlay flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm"
        >
          <input
            type="checkbox"
            class="accent-accent"
            checked={selected.includes(med.id)}
            onchange={() => toggle(med.id)}
          />
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background: {med.colour}"></span>
          <span class="truncate">{med.name}</span>
          {#if med.isArchived}
            <span class="text-text-muted ml-auto text-[10px] tracking-wide uppercase">archived</span
            >
          {/if}
        </label>
      {/each}
      {#if medications.length === 0}
        <p class="text-text-secondary px-2.5 py-2 text-sm">No medications yet</p>
      {/if}
      {#if selected.length > 0}
        <button
          type="button"
          class="text-text-secondary hover:text-text-primary mt-1 w-full rounded-md px-2.5 py-1.5 text-left text-xs"
          onclick={clear}
        >
          Clear filter
        </button>
      {/if}
    </div>
  {/if}
</div>
