<script lang="ts">
  import { getMedicationBackground } from "$lib/utils/medication-style";

  let {
    colour,
    colourSecondary,
    pattern,
    size = "md",
  }: {
    colour: string;
    colourSecondary: string | null;
    pattern: string;
    size?: "sm" | "md";
  } = $props();

  // `small = true`: at 28px and below a stripe, dot or check pattern is noise,
  // so getMedicationBackground swaps geometric patterns for a gradient.
  const background = $derived(getMedicationBackground(colour, colourSecondary, pattern, true));
</script>

<!-- Decorative: the name beside it carries the meaning. ring-border-strong,
     not glass-border, because a medication colour can equal the card's. -->
<span
  aria-hidden="true"
  data-medication-glyph={size}
  class="ring-border-strong inline-block shrink-0 rounded-full ring-1 {size === 'sm'
    ? 'h-2.5 w-5'
    : 'h-3.5 w-7'}"
  style="background: {background}"
></span>
