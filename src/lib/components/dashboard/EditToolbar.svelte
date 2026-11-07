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
    /**
     * Opens More options once the page says it is safe: the page waits for
     * the draft's writes, as Done does, because navigating away mid-write
     * would load the settings page with the old value.
     */
    onmore: (href: string) => void;
  };

  let { active, onpreset, ondone, onmore }: Props = $props();

  /** `from=dashboard`: the settings page's way back is to the dashboard, as from the footer link. */
  const MORE_OPTIONS_HREF = "/settings/dashboard?from=dashboard";

  // A plain click waits for the page; a click that opens a new tab or
  // window is the browser's, and leaves this page (and its writes) alone.
  function more(event: MouseEvent) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onmore(MORE_OPTIONS_HREF);
  }
</script>

<!-- The bar has a minimum height (min-h-30, 7.5rem: two h-11 rows, the gap,
     the padding and the border, with a little to spare), because app.css
     reserves that plus <main>'s bottom padding as the scroll container's
     scroll-padding-bottom while this toolbar exists, so a control Tab
     scrolls into view is never hidden under it (WCAG 2.2 2.4.11), and lifts
     the toast stack by the same reserve so an Undo offer never covers Done.
     Change one and change the other; edit-toolbar-scroll-reserve.svelte.test.ts
     and toast-clears-edit-toolbar.svelte.test.ts hold them together. -->
<div data-edit-toolbar class="sticky bottom-0 z-10 pb-[env(safe-area-inset-bottom)]">
  <div
    class="border-border-strong bg-surface-raised flex min-h-30 flex-wrap content-center items-center gap-2 rounded-lg border px-3 py-2 shadow-lg"
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
      <Button variant="ghost" href={MORE_OPTIONS_HREF} onclick={more}>More options</Button>
      <Button variant="primary" onclick={ondone}>Done</Button>
    </div>
  </div>
</div>
