<script lang="ts">
  /**
   * Edit mode's bar above one dashboard section (spec §5d): its name, ↑/↓,
   * and a "Shown" toggle, or the fixed text of a pinned section. Presentational:
   * the page owns the draft and passes the callbacks. Controls are the
   * primitives only, so each has the accent-ink ring and a fixed 44px target,
   * and an arrow at an end is aria-disabled, never disabled, so a press that
   * took a section to an end keeps focus on the page.
   */
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Toggle from "$lib/components/ui/Toggle.svelte";
  import type { DashboardSectionId } from "$lib/dashboard/layout";

  type Props = {
    /** The section, or "due" for the pinned Due region. Names the bar for tests and the ids. */
    id: DashboardSectionId | "due";
    /** `SECTION_LABELS` name, or a pinned section's fixed text. */
    label: string;
    /** A preference hides it: its content is drawn dimmed and the bar says so. */
    hidden?: boolean;
    /** A line under the controls: the urgent-refills floor made visible. */
    note?: string;
    /** The id prefix of the ↑/↓ buttons, so the page can return focus after a move. */
    movePrefix?: string;
    move?: {
      atStart: boolean;
      atEnd: boolean;
      onmove: (direction: "up" | "down") => void;
    };
    /** A hideable section's toggle, or "always" for Done. Absent on a pinned bar. */
    shown?: { pressed: boolean; onchange: (value: boolean) => void } | "always";
  };

  let {
    id,
    label,
    hidden = false,
    note,
    movePrefix = "editor-move",
    move,
    shown,
  }: Props = $props();
</script>

<div
  data-section-bar={id}
  role="group"
  aria-label={move ? label : undefined}
  class="border-border-strong flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
>
  <!-- Below sm the name takes its own line, so the controls wrap beneath it
       rather than letting words run under a button. -->
  <p class="min-w-0 basis-full text-sm font-medium sm:flex-1 sm:basis-auto">
    <span class="text-text-primary">{label}</span>
    {#if hidden}
      <span class="text-text-muted ml-2 font-normal">Hidden</span>
    {/if}
  </p>

  {#if move || shown}
    <div class="ml-auto flex items-center gap-2">
      {#if move}
        {@const arrows = move}
        {#each ["up", "down"] as const as direction (direction)}
          {@const atLimit = direction === "up" ? arrows.atStart : arrows.atEnd}
          <IconButton
            id="{movePrefix}-{id}-{direction}"
            variant="secondary"
            label="Move {label} {direction}"
            aria-disabled={atLimit ? "true" : undefined}
            onclick={() => {
              if (!atLimit) arrows.onmove(direction);
            }}
          >
            <span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span>
          </IconButton>
        {/each}
      {/if}

      {#if shown === "always"}
        <span class="text-text-muted text-sm">Always shown</span>
      {:else if shown}
        {@const toggle = shown}
        <Toggle size="md" pressed={toggle.pressed} onclick={() => toggle.onchange(!toggle.pressed)}
          >Shown</Toggle
        >
      {/if}
    </div>
  {/if}

  {#if note}
    <p class="text-text-secondary basis-full text-sm">{note}</p>
  {/if}
</div>
