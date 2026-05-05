<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import {
    getMedicationBackground,
    getReadableTextColor,
    PATTERN_OPTIONS,
  } from "$lib/utils/medication-style";
  import { PRESET_COLOURS } from "$lib/medications/medication-style-options";
  import type { FormErrors } from "$lib/medications/medication-form-errors";

  let {
    selectedColour = $bindable(),
    selectedColourSecondary = $bindable(),
    selectedPattern = $bindable(),
    errors,
  }: {
    selectedColour: string;
    selectedColourSecondary: string | null;
    selectedPattern: string;
    errors: FormErrors;
  } = $props();

  let showSecondary = $state(selectedColourSecondary !== null);
  const sampleFg = $derived(
    getReadableTextColor(selectedColour, selectedColourSecondary, selectedPattern),
  );
</script>

<fieldset class="m-0 space-y-0 border-0 p-0">
  <legend class="mb-2 block text-sm font-medium">
    Colour & Pattern
    <Tooltip
      text="Choose how this medication appears across the app — on cards, pills, and timeline entries."
    />
  </legend>

  <!-- Primary colour row -->
  <div class="mb-2">
    {#if showSecondary}<span class="text-text-muted mb-1 block text-xs">Primary</span>{/if}
    <div class="flex flex-wrap items-center gap-2">
      {#each PRESET_COLOURS as colour}
        <button
          type="button"
          onclick={() => (selectedColour = colour)}
          class="focus:ring-accent h-8 w-8 rounded-full transition-transform hover:scale-110 focus:ring-2 focus:ring-offset-2 focus:outline-none {selectedColour ===
          colour
            ? 'ring-accent scale-110 ring-2 ring-offset-2'
            : ''}"
          style="background-color: {colour}"
          aria-label="Select primary colour {colour}"
        ></button>
      {/each}
      {#if !showSecondary}
        <button
          type="button"
          onclick={() => {
            showSecondary = true;
            selectedColourSecondary = PRESET_COLOURS[2];
          }}
          class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-white/30 text-lg text-white/40 transition-colors hover:border-white/50 hover:text-white/60"
          aria-label="Add secondary colour">+</button
        >
      {/if}
    </div>
  </div>

  <!-- Secondary colour row (visible when + clicked) -->
  {#if showSecondary}
    <div class="mb-3">
      <span class="text-text-muted mb-1 block text-xs">Secondary</span>
      <div class="flex flex-wrap items-center gap-2">
        {#each PRESET_COLOURS as colour}
          <button
            type="button"
            onclick={() => (selectedColourSecondary = colour)}
            class="focus:ring-accent h-8 w-8 rounded-full transition-transform hover:scale-110 focus:ring-2 focus:ring-offset-2 focus:outline-none {selectedColourSecondary ===
            colour
              ? 'ring-accent scale-110 ring-2 ring-offset-2'
              : ''}"
            style="background-color: {colour}"
            aria-label="Select secondary colour {colour}"
          ></button>
        {/each}
        <button
          type="button"
          onclick={() => {
            showSecondary = false;
            selectedColourSecondary = null;
            selectedPattern = "solid";
          }}
          class="border-danger/50 text-danger/70 hover:border-danger hover:text-danger flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed text-sm transition-colors"
          aria-label="Remove secondary colour">&times;</button
        >
      </div>
    </div>

    <!-- Pattern grid -->
    <div class="mb-3">
      <span class="text-text-muted mb-1 block text-xs">Pattern</span>
      <div class="flex flex-wrap gap-2">
        {#each PATTERN_OPTIONS as pat}
          <button
            type="button"
            onclick={() => (selectedPattern = pat.id)}
            class="h-11 w-11 rounded-lg border-2 transition-transform hover:scale-105 {selectedPattern ===
            pat.id
              ? 'scale-105 border-white'
              : 'border-transparent'}"
            style="background: {getMedicationBackground(
              selectedColour,
              selectedColourSecondary,
              pat.id,
            )}"
            aria-label="Select {pat.name} pattern"
            title={pat.name}
          ></button>
        {/each}
      </div>
    </div>

    <!-- Live preview -->
    <div class="flex items-center gap-3">
      <span class="text-text-muted text-xs">Preview</span>
      <div
        class="h-10 w-10 rounded-lg"
        style="background: {getMedicationBackground(
          selectedColour,
          selectedColourSecondary,
          selectedPattern,
        )}"
      ></div>
      <div
        class="h-3 w-3 rounded-full"
        style="background: {getMedicationBackground(
          selectedColour,
          selectedColourSecondary,
          selectedPattern,
          true,
        )}"
      ></div>
      <div
        class="flex h-8 items-center rounded-full px-4 text-xs font-medium"
        style="background: {getMedicationBackground(
          selectedColour,
          selectedColourSecondary,
          selectedPattern,
        )}; color: {sampleFg.color}; text-shadow: {sampleFg.textShadow};"
      >
        Sample Pill
      </div>
    </div>
  {/if}

  {#if errors["colour"]?.[0]}<p class="text-danger mt-1 text-sm">{errors["colour"][0]}</p>{/if}
</fieldset>
