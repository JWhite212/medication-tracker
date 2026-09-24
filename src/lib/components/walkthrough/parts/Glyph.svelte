<script lang="ts">
  // The two small native-control glyphs the fake forms need: the <select>
  // chevron and the date input's calendar icon.
  let {
    name,
    size = 14,
    color = "var(--color-text-secondary)",
  }: { name: "chevron" | "calendar"; size?: number; color?: string } = $props();
</script>

{#if name === "chevron"}
  <svg width={size} height={size} viewBox="0 0 20 20" fill={color} class="shrink-0">
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
    />
  </svg>
{:else}
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--color-text-primary)"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="shrink-0 opacity-85"
  >
    <path d="M8 2v4" /><path d="M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path
      d="M3 10h18"
    />
  </svg>
{/if}
