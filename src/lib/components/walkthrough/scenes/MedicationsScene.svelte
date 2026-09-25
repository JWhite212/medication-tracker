<script lang="ts">
  // routes/(app)/medications/+page.svelte: MedicationCard.svelte for each of the
  // demo medications. `load` (seconds into the shot) staggers the adherence
  // bars and sparklines in; `tick` (0..1) rolls the "Last taken" timers over
  // by a minute.
  import Sparkline from "$components/Sparkline.svelte";
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import { HISTORY, MEDICATIONS } from "../demo-data";
  import { useMark } from "../marks";
  import { MOTION } from "../timeline";

  let { load, tick }: { load: number; tick: number } = $props();

  const mark = useMark();
</script>

<div class="flex flex-col gap-6">
  <div class="flex items-center justify-between">
    <p class="text-2xl font-bold">Medications</p>
    <span
      class="bg-accent text-accent-fg rounded-lg px-4 py-2 text-sm font-medium whitespace-nowrap"
      >+ Add Medication</span
    >
  </div>
  <div class="flex flex-col gap-3">
    {#each MEDICATIONS as medication, i (medication.id)}
      {@const adherence = HISTORY.weeklyAdherence[i]}
      {@const fill = MOTION.enter(load, 0.15 + i * 0.08, 0.7)}
      {@const draw = MOTION.enter(load, 0.25 + i * 0.08, 0.9)}
      <div class="flex items-center gap-2">
        <!-- Reorder arrows at the page's 32x44 size; the first can't move up
             and the last can't move down -->
        <div class="flex flex-col gap-1">
          <span
            class="text-text-muted flex h-11 w-8 items-center justify-center rounded-md text-xs {i ===
            0
              ? 'opacity-30'
              : ''}">▲</span
          >
          <span
            class="text-text-muted flex h-11 w-8 items-center justify-center rounded-md text-xs {i ===
            MEDICATIONS.length - 1
              ? 'opacity-30'
              : ''}">▼</span
          >
        </div>
        <div use:mark={"m.card" + i} class="min-w-0 flex-1">
          <!-- The Log button is a column of its own beside the card's body,
               as in MedicationCard.svelte, rather than laid over the chips -->
          <div class="border-glass-border bg-glass relative flex rounded-xl border">
            <div class="min-w-0 flex-1 p-4 pr-3">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div class="flex min-w-0 grow basis-48 items-center gap-4">
                  <div
                    class="h-10 w-10 shrink-0 rounded-lg"
                    style:background={getMedicationBackground(
                      medication.colour,
                      medication.colourSecondary,
                      medication.pattern,
                    )}
                  ></div>
                  <div class="min-w-0 flex-1 wrap-anywhere">
                    <p class="font-medium">{medication.name}</p>
                    <p class="text-text-secondary text-sm">
                      {medication.amount}{medication.unit} · {medication.form}
                      <span class="bg-glass ml-2 rounded-full px-2 py-0.5 text-xs"
                        >{medication.category}</span
                      >
                    </p>
                  </div>
                </div>
                {#if medication.refillWatch}
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      class="bg-info/15 text-info rounded-full px-2 py-1 text-xs font-medium whitespace-nowrap"
                      >{medication.supplyDays}d left</span
                    >
                  </div>
                {/if}
              </div>
              <div
                use:mark={"m.stats" + i}
                class="text-text-secondary mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs"
              >
                <span class="whitespace-nowrap"
                  >Last taken:
                  {#if tick <= 0}
                    <span class="tabular-nums">{medication.lastTaken}</span>
                  {:else if tick >= 1}
                    <span class="tabular-nums">{medication.lastTakenNext}</span>
                  {:else}
                    <!-- Odometer roll: old value slides up and out as the new one arrives -->
                    <span class="inline-grid h-4 overflow-hidden align-bottom tabular-nums">
                      <span
                        style:grid-area="1 / 1"
                        style:transform="translateY({-tick * 100}%)"
                        style:opacity={1 - tick}>{medication.lastTaken}</span
                      >
                      <span
                        style:grid-area="1 / 1"
                        style:transform="translateY({(1 - tick) * 100}%)"
                        style:opacity={tick}>{medication.lastTakenNext}</span
                      >
                    </span>
                  {/if}
                </span>
                <span class="whitespace-nowrap {medication.supplyDays <= 7 ? 'text-warning' : ''}"
                  >~{medication.supplyDays}d supply left</span
                >
              </div>
              <div class="mt-2 flex items-center gap-2">
                <div class="bg-glass h-1.5 flex-1 overflow-hidden rounded-full">
                  <div
                    class="h-full rounded-full"
                    style:width="{adherence * fill}%"
                    style:background={medication.colour}
                  ></div>
                </div>
                <span class="text-text-muted shrink-0 text-xs tabular-nums">{adherence}%</span>
              </div>
              <div class="text-text-muted mt-2 flex items-center gap-2">
                <span class="text-[10px] tracking-wider uppercase">14d</span>
                <!-- Clipped from the right so the line draws in left to right -->
                <div
                  class="flex-1"
                  style:color={medication.colour}
                  style:clip-path={draw < 1
                    ? `inset(0 ${((1 - draw) * 100).toFixed(2)}% 0 0)`
                    : undefined}
                >
                  <Sparkline values={HISTORY.sparklines[i]} height={20} />
                </div>
              </div>
            </div>
            <span
              class="border-border-strong text-accent-ink mt-4 mr-4 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center self-start rounded-lg border px-3 text-sm font-medium"
              >Log</span
            >
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>
