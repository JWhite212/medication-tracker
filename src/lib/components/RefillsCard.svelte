<script lang="ts" module>
  import type { RefillForecastEntry, RefillSeverity } from "$lib/types";
  import { REORDER_SOON } from "$lib/utils/dashboard-copy";
  import { refillStatus, toneClass, toneOf, type Tone } from "$lib/utils/status-tone";

  // Exported so a surface that cannot mount this card still tints and words
  // its rows by the same rules: the landing-page walkthrough draws Refills
  // with no link, heading or landmark, and this card renders all three. The
  // medications card's chip reads `refillChip` too, so "running low" is
  // written once. Not every surface applies all of it: the medications card
  // passes the user's alert threshold, but the dashboard's rows pass none,
  // because the forecast carries tiers only. A medication at its threshold
  // with an ok forecast is amber on /medications and absent here.

  /** The row box. A neutral row stays glass, like the dashboard's other cards. */
  export function refillSeverityClass(severity: RefillSeverity): string {
    const tone = toneOf(refillStatus(severity));
    return tone === "neutral" ? "border-glass-border bg-glass" : toneClass(tone, "alert");
  }

  /** The label's text colour. */
  export function refillSeverityLabel(severity: RefillSeverity): string {
    return toneClass(toneOf(refillStatus(severity)), "text");
  }

  export function refillDaysLabel(days: number | null): string {
    if (days === null) return "Refill needed";
    if (days <= 0) return "Out today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  }

  export function refillDosesLabel(count: number): string {
    if (count <= 0) return "None left";
    if (count === 1) return "1 dose left";
    return `${count} doses left`;
  }

  export type RefillChipInput = {
    severity: RefillSeverity;
    daysUntilRefill: number | null;
    inventoryCount: number | null;
    inventoryAlertThreshold: number | null;
  };

  export type RefillChip = { tone: Tone; glyph: "▲" | null; text: string };

  /**
   * The one rule for "is this running low?", shared by the dashboard's Refills
   * rows, the medications card's chip and the walkthrough. Amber when the
   * forecast tier needs you OR the count is at or below the user's own alert
   * threshold; neutral "N days left" for the watch tier; nothing otherwise.
   * Days when there is a forecast, doses when there is not. The threshold half
   * applies only where a caller passes one: the dashboard's rows pass null, so
   * there the forecast tier alone decides.
   */
  export function refillChip(input: RefillChipInput): RefillChip | null {
    const { severity, daysUntilRefill, inventoryCount, inventoryAlertThreshold } = input;
    const low =
      inventoryCount !== null &&
      inventoryAlertThreshold !== null &&
      inventoryCount <= inventoryAlertThreshold;
    const tone: Tone | null = low
      ? toneOf("stock-low")
      : severity === "ok"
        ? null
        : toneOf(refillStatus(severity));
    if (tone === null) return null;
    if (tone !== "needs-you") return { tone, glyph: null, text: refillDaysLabel(daysUntilRefill) };
    const left =
      daysUntilRefill === null && inventoryCount !== null
        ? refillDosesLabel(inventoryCount)
        : refillDaysLabel(daysUntilRefill);
    return { tone, glyph: "▲", text: `${REORDER_SOON} · ${left}` };
  }
</script>

<script lang="ts">
  type Props = { entries: RefillForecastEntry[] };
  let { entries }: Props = $props();
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
        <!-- The forecast lists only the non-ok tiers and carries no alert
             threshold, so the tier alone decides. The `??` below is
             unreachable from getRefillForecast and keeps a row from ever
             rendering empty. -->
        {@const label = refillChip({
          severity: entry.severity,
          daysUntilRefill: entry.daysUntilRefill,
          inventoryCount: entry.inventoryCount,
          inventoryAlertThreshold: null,
        })}
        <!-- Hover swaps the background for glass-hover rather than fading the
             row: at 90% opacity the amber label fell below 4.5:1 in light. -->
        <a
          href="/medications/{entry.medicationId}"
          class="hover:bg-glass-hover flex items-center gap-3 rounded-lg border p-3 transition-colors {refillSeverityClass(
            entry.severity,
          )}"
        >
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            style="background-color: {entry.colour}"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 flex-1 truncate font-medium">{entry.medicationName}</span>
          <span class="shrink-0 text-xs {refillSeverityLabel(entry.severity)}">
            <!-- The space is an expression because Svelte drops a literal one at an {#if} edge. -->
            <!-- eslint-disable-next-line svelte/no-useless-mustaches -->
            {#if label?.glyph}<span aria-hidden="true">{label.glyph}</span>{" "}{/if}{label?.text ??
              refillDaysLabel(entry.daysUntilRefill)}
          </span>
        </a>
      {/each}
    </div>
  </section>
{/if}
