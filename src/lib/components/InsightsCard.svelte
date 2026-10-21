<script lang="ts">
  import GlassCard from "$components/ui/GlassCard.svelte";
  import type { Insight, InsightSignal } from "$lib/types";
  import { toneClass, toneOf } from "$lib/utils/status-tone";

  type Props = { insights: Insight[] };
  let { insights }: Props = $props();

  // The glyph says which way an insight points. It is aria-hidden because the
  // sentence already says it ("improved", "Lowest", "Reorder soon:"). Only the
  // actionable insight is coloured; every other one is neutral.
  const GLYPH: Record<InsightSignal, string> = { "needs-you": "▲", down: "↓", up: "↑", info: "•" };
  const toneFor = (signal: InsightSignal) =>
    toneOf(signal === "needs-you" ? "insight-needs-you" : "insight-info");
</script>

{#if insights.length > 0}
  <GlassCard>
    <h2 class="mb-3 text-lg font-semibold">Insights</h2>
    <ul class="space-y-2" role="list">
      {#each insights as insight (insight.id)}
        {@const ink = toneClass(toneFor(insight.signal), "text")}
        <li class="flex items-start gap-3 text-sm">
          <span class="w-3 shrink-0 text-center {ink}" aria-hidden="true"
            >{GLYPH[insight.signal]}</span
          >
          <!-- The space after the lead is an expression because Svelte drops a literal one at an {#if} edge. -->
          <!-- eslint-disable svelte/no-useless-mustaches -->
          <span class="text-text-primary"
            >{#if insight.lead}<span class="font-semibold {ink}">{insight.lead}:</span
              >{" "}{/if}{insight.text}</span
          >
          <!-- eslint-enable svelte/no-useless-mustaches -->
        </li>
      {/each}
    </ul>
  </GlassCard>
{/if}
