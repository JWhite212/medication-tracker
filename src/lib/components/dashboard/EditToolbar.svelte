<script lang="ts">
  /**
   * Edit mode's sticky bottom bar (spec §5d, §5g): the four presets, or
   * "Custom" when the draft matches none, a link to the settings page for
   * everything edit mode leaves there, and Done. It sits in the page column
   * and outside every GlassCard, because `backdrop-blur-xl` makes a card the
   * containing block and a sticky bar inside one would stick to the card.
   * The presets scroll sideways inside the bar, never across the page.
   */
  import Button from "$lib/components/ui/Button.svelte";
  import Toggle from "$lib/components/ui/Toggle.svelte";
  import { PRESET_IDS, PRESETS, type PresetId } from "$lib/dashboard/presets";

  type Props = {
    active: PresetId | null;
    onpreset: (id: PresetId) => void;
    ondone: () => void;
  };

  let { active, onpreset, ondone }: Props = $props();
</script>

<div data-edit-toolbar class="sticky bottom-0 z-10 pb-[env(safe-area-inset-bottom)]">
  <div
    class="border-border-strong bg-surface-raised flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 shadow-lg"
  >
    <div
      role="group"
      aria-label="Presets"
      class="-m-1 flex min-w-0 basis-full gap-2 overflow-x-auto p-1"
    >
      {#each PRESET_IDS as id (id)}
        <Toggle size="md" class="shrink-0" pressed={active === id} onclick={() => onpreset(id)}
          >{PRESETS[id].label}</Toggle
        >
      {/each}
    </div>
    {#if active === null}
      <span class="text-text-secondary text-sm">Custom</span>
    {/if}
    <div class="ml-auto flex items-center gap-2">
      <Button variant="ghost" href="/settings/dashboard">More options</Button>
      <Button variant="primary" onclick={ondone}>Done</Button>
    </div>
  </div>
</div>
