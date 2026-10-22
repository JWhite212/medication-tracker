<script lang="ts">
  import Alert from "$lib/components/ui/Alert.svelte";

  let { warnings = [] }: { warnings?: string[] } = $props();
</script>

<!-- Needs you, not wrong: an amber notice, announced politely when it appears.
     It was role="alert", which interrupts, and which MedicationForm's focus
     fallback then took for the form's own message. The status region is always
     mounted, so a screen reader has it before its content changes. -->
<div role="status">
  {#if warnings.length > 0}
    <Alert tone="needs-you" title="Experimental interaction notice" class="mt-2">
      {#each warnings as warning}
        <p>{warning}</p>
      {/each}
      <p class="text-text-muted mt-2 text-xs">
        This check may miss interactions and may produce false positives. It is not a substitute for
        professional medical advice.
      </p>
    </Alert>
  {/if}
</div>
