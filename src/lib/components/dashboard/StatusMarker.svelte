<script lang="ts">
  import { STATUS_MARKER_LABELS, type StatusMarkerState } from "./status-marker";

  // Renamed on destructure: a local binding called `state` would collide with
  // the `$state` rune the moment anyone added one to this component.
  let { state: marker }: { state: StatusMarkerState } = $props();

  // Shape first, colour as reinforcement — status is never carried by colour alone.
  const RECIPES: Record<StatusMarkerState, string> = {
    taken: "bg-success/20 text-success",
    overdue: "bg-warning/20 text-warning",
    "due-now": "ring-2 ring-accent-ink",
    upcoming: "border border-border-strong",
    skipped: "border border-border-strong text-text-secondary",
    missed: "border border-border-strong text-text-secondary",
  };
</script>

<!-- `role="img"` is required, not decoration. This marker is the only thing
     that states a dose's status to a screen reader, and a bare <span> has the
     implicit `generic` role, which PROHIBITS naming — the aria-label is
     discarded. Caught on production by Lighthouse (`aria-prohibited-attr`).
     Pinned by tests/unit/status-marker-ssr.test.ts. -->
<span
  role="img"
  aria-label={STATUS_MARKER_LABELS[marker]}
  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {RECIPES[marker]}"
>
  {#if marker === "taken"}
    <svg
      class="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,6 5,9 10,3" />
    </svg>
  {:else if marker === "overdue"}
    <svg
      class="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="7" />
      <circle cx="6" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  {:else if marker === "due-now"}
    <span class="bg-accent-ink h-2 w-2 rounded-full"></span>
  {:else if marker === "skipped" || marker === "missed"}
    <svg
      class="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="9" y2="6" />
    </svg>
  {/if}
</span>
