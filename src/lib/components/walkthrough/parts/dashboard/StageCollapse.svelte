<script lang="ts">
  // Draws its content at `factor` × its natural height, without measuring
  // anything: a one-row grid whose row is `factor`fr sizes that row to
  // factor × the content's height, because the content's overflow-hidden box
  // has no minimum size of its own. 1 is the natural layout, with no style at
  // all; 0 is zero height and fully transparent.
  //
  // The content is mounted at every factor, so a mark inside it is registered
  // at every T, and its offsetTop and offsetHeight are the natural ones
  // whatever the factor: measured geometry never depends on T.
  import type { Snippet } from "svelte";

  let { factor, children }: { factor: number; children: Snippet } = $props();
</script>

<div
  class="grid"
  style:grid-template-rows={factor >= 1 ? undefined : `${factor}fr`}
  style:opacity={factor >= 1 ? undefined : factor}
>
  <div class="min-h-0 overflow-hidden">
    {@render children()}
  </div>
</div>
