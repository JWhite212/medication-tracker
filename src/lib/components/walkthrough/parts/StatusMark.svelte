<script lang="ts">
  // The 20px status circle at the start of each My Day row.
  let { kind }: { kind: "taken" | "overdue" | "upcoming" } = $props();
</script>

{#if kind === "taken"}
  <span
    class="bg-success/20 text-success absolute inset-0 flex items-center justify-center rounded-full"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"><polyline points="2,6 5,9 10,3" /></svg
    >
  </span>
{:else if kind === "overdue"}
  <span
    class="bg-warning/20 text-warning absolute inset-0 flex items-center justify-center rounded-full"
  >
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="7" /><circle
        cx="6"
        cy="9.5"
        r="0.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  </span>
{:else}
  <span
    class="border-glass-border absolute inset-0 flex items-center justify-center rounded-full border"
  >
    <span class="bg-text-muted/40 h-2 w-2 rounded-full"></span>
  </span>
{/if}
