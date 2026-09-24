<script lang="ts">
  // A closed <select> as the medication form and export settings draw it.
  import Glyph from "./Glyph.svelte";

  let { label, value }: { label: string; value: string } = $props();
</script>

<div>
  <p class="mb-1 block text-sm font-medium">{label}</p>
  <div
    class="border-border-strong bg-surface-raised text-text-primary flex h-[46px] items-center justify-between rounded-lg border px-4 text-base"
  >
    <span>{value}</span>
    <Glyph name="chevron" size={16} color="var(--color-text-primary)" />
  </div>
</div>
