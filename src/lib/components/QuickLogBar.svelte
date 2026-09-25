<script lang="ts">
  import { page } from "$app/state";
  import DoseActionForm from "$components/dashboard/DoseActionForm.svelte";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import { getDashboardClock } from "$components/dashboard/dashboard-clock";
  import { logToastFromReload } from "$components/dashboard/dose-toasts";
  import { formatDoseLabel } from "$lib/utils/dashboard-copy";
  import type { TimeFormat } from "$lib/utils/time";
  import type { Medication } from "$lib/types";

  let {
    medications,
    todayStart,
    timezone,
    timeFormat,
  }: {
    medications: Medication[];
    /** Only for the toast's fallback sentence, when the reload has no Done row for the dose. */
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
  } = $props();

  const clock = getDashboardClock();

  const MIN_QTY = 1;
  const MAX_QTY = 10;

  // Per-chip quantity. It resets to 1 only after a SUCCESSFUL log; a failed
  // log keeps it, so a retry submits what the user chose. The old pill kept
  // it after success too: it still read "3×" after a ×3 log.
  let quantities: Record<string, number> = $state({});

  function qtyOf(medId: string): number {
    return quantities[medId] ?? MIN_QTY;
  }

  function setQty(medId: string, value: number): void {
    quantities[medId] = Math.max(MIN_QTY, Math.min(MAX_QTY, value));
  }

  /**
   * The chip's success toast. DoseActionForm calls it after `update()` and
   * `tick()`, so `page.data` is the RELOADED payload and the sentence states
   * which slots the dose actually covered (`logToastFromReload`, the same
   * helper Log now uses). Every other value is resolved when the chip renders.
   */
  function chipToast(med: Medication, quantity: number): (doseId: string | null) => string {
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const dayStart = todayStart;
    const tz = timezone;
    const tf = timeFormat;
    return (doseId) =>
      logToastFromReload(
        page.data,
        doseId,
        { label, quantity, takenAt: clock.serverNow(), todayStart: dayStart },
        tz,
        tf,
      );
  }
</script>

<ul role="list" class="flex flex-wrap gap-2">
  {#each medications as med (med.id)}
    {@const qty = qtyOf(med.id)}
    {@const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit)}
    <!-- Neutral on purpose: the medication's colours appear only in the
         aria-hidden glyph, never behind text. Gradient, striped and two-tone
         pills ran the name across colour boundaries, and opacity on the
         steppers undid getReadableTextColor's worst-case contrast. -->
    <li
      class="border-border-strong bg-glass text-text-primary flex h-11 items-center overflow-hidden rounded-full border"
    >
      <!-- Rendered at every quantity, so the log segment never moves under the
           thumb. At 1 it is aria-disabled, not `disabled`, so it keeps focus. -->
      <button
        type="button"
        class="hover:bg-surface-overlay aria-disabled:text-text-muted flex h-11 w-11 shrink-0 items-center justify-center text-base select-none aria-disabled:cursor-not-allowed"
        aria-label="Decrease quantity for {med.name}"
        aria-disabled={qty <= MIN_QTY}
        onclick={() => setQty(med.id, qty - 1)}>−</button
      >
      <!-- DoseActionForm renders `children` BEFORE `label`, inside the button:
           the aria-hidden glyph, then the sr-only "Log ", so the accessible
           name is "Log Ibuprofen 200mg ×2" and starts with nothing visible
           that is not also in it. `label` is the visible text; it is never
           repeated in the children. {"Log "}, not a literal "Log ": Svelte 5
           trims whitespace at the end of an element, so a literal space is
           dropped and the name would read "LogIbuprofen". -->
      <DoseActionForm
        action="?/logDose"
        fields={{ medicationId: med.id, quantity: String(qty) }}
        label={qty > 1 ? `${label} ×${qty}` : label}
        pendingLabel="Logging…"
        variant="chip"
        quickLog
        undoable
        buildToast={chipToast(med, qty)}
        onSuccess={() => setQty(med.id, MIN_QTY)}
      >
        <MedicationGlyph
          colour={med.colour}
          colourSecondary={med.colourSecondary}
          pattern={med.pattern}
          size="sm"
        />
        <!-- eslint-disable-next-line svelte/no-useless-mustaches -->
        <span class="sr-only">{"Log "}</span>
      </DoseActionForm>
      <button
        type="button"
        class="hover:bg-surface-overlay aria-disabled:text-text-muted flex h-11 w-11 shrink-0 items-center justify-center text-base select-none aria-disabled:cursor-not-allowed"
        aria-label="Increase quantity for {med.name}"
        aria-disabled={qty >= MAX_QTY}
        onclick={() => setQty(med.id, qty + 1)}>+</button
      >
    </li>
  {/each}
</ul>
