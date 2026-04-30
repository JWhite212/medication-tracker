<script lang="ts">
  import GlassCard from "$components/ui/GlassCard.svelte";
  import type { Insight } from "$lib/types";

  type Props = { insights: Insight[] };
  let { insights }: Props = $props();

  function dotClass(severity: Insight["severity"]): string {
    if (severity === "warning") return "bg-warning";
    if (severity === "positive") return "bg-success";
    return "bg-accent";
  }
</script>

{#if insights.length > 0}
  <GlassCard>
    <h2 class="mb-3 text-lg font-semibold">Insights</h2>
    <ul class="space-y-2" role="list">
      {#each insights as insight (insight.id)}
        <li class="flex items-start gap-3">
          <span
            class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full {dotClass(insight.severity)}"
            aria-hidden="true"
          ></span>
          <span class="text-text-primary text-sm">{insight.text}</span>
        </li>
      {/each}
    </ul>
  </GlassCard>
{/if}
