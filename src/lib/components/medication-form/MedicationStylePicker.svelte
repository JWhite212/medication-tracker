<script lang="ts">
  import Tooltip from "$lib/components/ui/Tooltip.svelte";
  import {
    getMedicationBackground,
    getReadableTextColor,
    PATTERN_OPTIONS,
  } from "$lib/utils/medication-style";
  import { PRESET_COLOURS } from "$lib/medications/medication-style-options";
  import { colourName, isPresetColour } from "$lib/medications/medication-colour-names";
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

  // A stored colour outside the presets (the API and import doors accept any
  // hex) is offered as one more radio, or its group would have nothing checked
  // and no way back to the colour the medication already has. Captured once,
  // like `showSecondary`, so it stays selectable after the user tries a preset.
  // The secondary is tested for truthiness because a failed submit echoes the
  // hidden input's "" back, and that is no colour at all.
  const primaryOptions: readonly string[] = isPresetColour(selectedColour)
    ? PRESET_COLOURS
    : [...PRESET_COLOURS, selectedColour];
  const secondaryOptions: readonly string[] =
    !selectedColourSecondary || isPresetColour(selectedColourSecondary)
      ? PRESET_COLOURS
      : [...PRESET_COLOURS, selectedColourSecondary];
</script>

<!-- Selection is the check; focus is the ring. Both used to be the same
     accent ring, so a keyboard user could not tell the swatch they were on
     from the one that was chosen, and nothing but colour said which it was.
     The check follows `:checked` rather than component state, so the SSR
     markup is already right before hydration. -->
{#snippet selectedMark()}
  <span
    aria-hidden="true"
    class="bg-text-primary text-surface pointer-events-none absolute -top-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full peer-checked:flex"
  >
    <svg
      class="h-2.5 w-2.5"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="2,6 5,9 10,3" />
    </svg>
  </span>
{/snippet}

{#snippet colourSwatch(colour: string)}
  <span
    class="peer-focus-visible:ring-accent-ink block h-8 w-8 rounded-full transition-transform peer-checked:scale-110 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 hover:scale-110"
    style="background-color: {colour}"
  ></span>
  {@render selectedMark()}
  <span class="sr-only">{colourName(colour)}</span>
{/snippet}

<!-- See MedicationNotificationFields for why the name is scoped to a span. -->
<fieldset class="m-0 space-y-0 border-0 p-0" aria-labelledby="stylePickerLegend">
  <legend class="mb-2 block text-sm font-medium">
    <span id="stylePickerLegend">Colour & Pattern</span>
    <Tooltip
      label="Colour & Pattern"
      text="Choose how this medication appears across the app — on cards, pills, and timeline entries."
    />
  </legend>

  <!-- Each group below is a set of native radios, the same shape as the accent
       picker on Appearance, so arrow keys, a single tab stop and "3 of 16" come
       from the browser. They sit inside MedicationForm's <form>, and an unnamed
       radio is a group of one, so they carry the exact names and values that
       form already posts through its hidden inputs rather than no name at all.
       The hidden inputs stay the source of truth: they come later in the form
       and the action's Object.fromEntries keeps the last value, and they are
       what covers a colour no radio here holds. -->

  <!-- Primary colour row -->
  <fieldset class="m-0 mb-2 border-0 p-0">
    <legend class={showSecondary ? "text-text-muted mb-1 block text-xs" : "sr-only"}>
      Primary colour
    </legend>
    <div class="flex flex-wrap items-center gap-2">
      {#each primaryOptions as colour (colour)}
        <label class="relative cursor-pointer" title={colourName(colour)}>
          <input
            type="radio"
            name="colour"
            value={colour}
            bind:group={selectedColour}
            class="peer sr-only"
          />
          {@render colourSwatch(colour)}
        </label>
      {/each}
      {#if !showSecondary}
        <button
          type="button"
          onclick={() => {
            showSecondary = true;
            selectedColourSecondary = PRESET_COLOURS[2];
          }}
          class="border-border-strong text-text-muted hover:text-text-secondary flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed text-lg transition-colors"
          aria-label="Add secondary colour">+</button
        >
      {/if}
    </div>
  </fieldset>

  <!-- Secondary colour row (visible when + clicked) -->
  {#if showSecondary}
    <fieldset class="m-0 mb-3 border-0 p-0">
      <legend class="text-text-muted mb-1 block text-xs">Secondary colour</legend>
      <div class="flex flex-wrap items-center gap-2">
        {#each secondaryOptions as colour (colour)}
          <label class="relative cursor-pointer" title={colourName(colour)}>
            <input
              type="radio"
              name="colourSecondary"
              value={colour}
              bind:group={selectedColourSecondary}
              class="peer sr-only"
            />
            {@render colourSwatch(colour)}
          </label>
        {/each}
        <button
          type="button"
          onclick={() => {
            showSecondary = false;
            selectedColourSecondary = null;
            selectedPattern = "solid";
          }}
          class="border-danger-ink/50 text-danger-ink/70 hover:border-danger-ink hover:text-danger-ink flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed text-sm transition-colors"
          aria-label="Remove secondary colour">&times;</button
        >
      </div>
    </fieldset>

    <!-- Pattern grid -->
    <fieldset class="m-0 mb-3 border-0 p-0">
      <legend class="text-text-muted mb-1 block text-xs">Pattern</legend>
      <div class="flex flex-wrap gap-2">
        {#each PATTERN_OPTIONS as pat (pat.id)}
          <label class="relative cursor-pointer" title={pat.name}>
            <input
              type="radio"
              name="pattern"
              value={pat.id}
              bind:group={selectedPattern}
              class="peer sr-only"
            />
            <span
              class="peer-checked:border-text-primary peer-focus-visible:ring-accent-ink block h-11 w-11 rounded-lg border-2 border-transparent transition-transform peer-checked:scale-105 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 hover:scale-105"
              style="background: {getMedicationBackground(
                selectedColour,
                selectedColourSecondary,
                pat.id,
              )}"
            ></span>
            {@render selectedMark()}
            <span class="sr-only">{pat.name}</span>
          </label>
        {/each}
      </div>
    </fieldset>

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

  {#if errors["colour"]?.[0]}<p id="colour-error" class="text-danger-ink mt-1 text-sm" role="alert">
      {errors["colour"][0]}
    </p>{/if}
</fieldset>
