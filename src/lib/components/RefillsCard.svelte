<script lang="ts">
  import type { RefillForecastEntry } from "$lib/server/inventory";

  type Props = { entries: RefillForecastEntry[] };
  let { entries }: Props = $props();

  function severityClass(severity: RefillForecastEntry["severity"]): string {
    if (severity === "critical") return "border-danger/40 bg-danger/5";
    if (severity === "warning") return "border-warning/40 bg-warning/5";
    return "border-glass-border bg-glass";
  }

  function severityLabel(severity: RefillForecastEntry["severity"]): string {
    if (severity === "critical") return "text-danger";
    if (severity === "warning") return "text-warning";
    return "text-text-secondary";
  }

  function daysLabel(days: number | null): string {
    if (days === null) return "Refill needed";
    if (days <= 0) return "Out today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  }
</script>

{#if entries.length > 0}
  <section aria-labelledby="refills-heading">
    <h2
      id="refills-heading"
      class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
    >
      Refills
    </h2>
    <div class="space-y-2">
      {#each entries as entry (entry.medicationId)}
        <a
          href="/medications/{entry.medicationId}"
          class="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:opacity-90 {severityClass(
            entry.severity,
          )}"
        >
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            style="background-color: {entry.colour}"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 flex-1 truncate font-medium">{entry.medicationName}</span>
          <span class="shrink-0 text-xs {severityLabel(entry.severity)}">
            {daysLabel(entry.daysUntilRefill)}
          </span>
        </a>
      {/each}
    </div>
  </section>
{/if}
