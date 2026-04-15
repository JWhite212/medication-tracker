<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassCard from '$lib/components/ui/GlassCard.svelte';

  let { data, form } = $props();

  const presetColours = [
    '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b',
    '#10b981', '#06b6d4', '#3b82f6', '#f97316', '#64748b'
  ];

  let selectedColour = $state(data.preferences.accentColor);
</script>

<svelte:head>
  <title>Appearance — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl w-full space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Appearance</h1>
  </div>

  {#if form?.success}
    <p class="rounded-lg bg-success/10 px-4 py-2 text-sm text-success">Appearance settings saved.</p>
  {/if}

  <GlassCard>
    <form method="POST" use:enhance class="space-y-6">
      <div>
        <label class="mb-2 block text-sm font-medium">Accent Colour</label>
        <input type="hidden" name="accentColor" value={selectedColour} />
        <div class="flex flex-wrap gap-2">
          {#each presetColours as colour}
            <button
              type="button"
              class="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 {selectedColour === colour ? 'border-white scale-110' : 'border-transparent'}"
              style="background-color: {colour}"
              onclick={() => (selectedColour = colour)}
              aria-label="Select colour {colour}"
            ></button>
          {/each}
        </div>
      </div>

      <div>
        <label for="dateFormat" class="mb-1 block text-sm font-medium">Date Format</label>
        <select
          id="dateFormat"
          name="dateFormat"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {#each ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as fmt}
            <option value={fmt} selected={fmt === data.preferences.dateFormat}>{fmt}</option>
          {/each}
        </select>
      </div>

      <div>
        <label for="timeFormat" class="mb-1 block text-sm font-medium">Time Format</label>
        <select
          id="timeFormat"
          name="timeFormat"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="12h" selected={data.preferences.timeFormat === '12h'}>12-hour (2:30 PM)</option>
          <option value="24h" selected={data.preferences.timeFormat === '24h'}>24-hour (14:30)</option>
        </select>
      </div>

      <div>
        <label for="uiDensity" class="mb-1 block text-sm font-medium">Display Density</label>
        <select
          id="uiDensity"
          name="uiDensity"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="comfortable" selected={data.preferences.uiDensity === 'comfortable'}>Comfortable</option>
          <option value="compact" selected={data.preferences.uiDensity === 'compact'}>Compact</option>
        </select>
      </div>

      <div class="flex items-center gap-3">
        <input
          type="checkbox"
          id="reducedMotion"
          name="reducedMotion"
          checked={data.preferences.reducedMotion}
          class="h-4 w-4 rounded border-glass-border bg-surface-raised text-accent focus:ring-accent"
        />
        <label for="reducedMotion" class="text-sm font-medium">Reduce motion</label>
      </div>

      <button
        type="submit"
        class="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Save Changes
      </button>
    </form>
  </GlassCard>
</div>
