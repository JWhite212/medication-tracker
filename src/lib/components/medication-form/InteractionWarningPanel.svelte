<script lang="ts">
  let { warnings }: { warnings: string[] } = $props();
</script>

{#if warnings.length > 0}
  <div class="border-warning/30 bg-warning/5 rounded-lg border px-4 py-3" role="alert">
    <p class="text-warning mb-1 text-xs font-medium tracking-wider uppercase">
      Experimental interaction notice
    </p>
    {#each warnings as warning}
      <p class="text-text-secondary text-sm">{warning}</p>
    {/each}
    <p class="text-text-muted mt-2 text-xs">
      This check may miss interactions and may produce false positives. It is not a substitute for
      professional medical advice.
    </p>
  </div>
{/if}
