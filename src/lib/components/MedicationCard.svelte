<script lang="ts">
  import type { MedicationWithStats } from "$lib/types";
  import { getMedicationBackground } from "$lib/utils/medication-style";
  import { expectedWeeklyDoses, adherencePercent } from "$lib/utils/adherence";
  import { deserialize } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import type { ActionResult } from "@sveltejs/kit";
  import { showToast } from "$components/ui/Toast.svelte";
  import { actionErrorMessage } from "$lib/utils/form-errors";
  import TimeSince from "$components/TimeSince.svelte";
  import Sparkline from "$components/Sparkline.svelte";

  let { medication }: { medication: MedicationWithStats } = $props();

  function refillChipClass(severity: MedicationWithStats["refillSeverity"]): string {
    if (severity === "critical") return "bg-danger/15 text-danger-ink";
    if (severity === "warning") return "bg-warning/15 text-warning";
    if (severity === "watch") return "bg-info/15 text-info";
    return "";
  }

  const isScheduled = $derived(medication.scheduleType === "scheduled");
  const weeklyExpected = $derived(
    expectedWeeklyDoses(medication.expectedDailyDoses, medication.scheduleIntervalHours),
  );
  const adherence = $derived(
    isScheduled ? adherencePercent(medication.weeklyDoseCount, weeklyExpected) : 0,
  );

  // The status chips, decided here rather than inline so the header can tell
  // whether it has any. On a narrow card the chip group wraps onto a row of
  // its own under the name, and an empty group would still take that row and
  // open a gap there, so it is only rendered when it holds something.
  //
  // Explicit === false, not !medication.notificationsEnabled: a row that
  // reaches this component without the field (an older cached payload, or a
  // narrowed projection added later) would be undefined, and the falsy form
  // would render "Muted" on every medication. This fails safe instead.
  const muted = $derived(medication.notificationsEnabled === false);
  const refillChip = $derived(
    Boolean(medication.refillSeverity && medication.refillSeverity !== "ok"),
  );
  const lowStockChip = $derived(
    !refillChip &&
      medication.inventoryCount !== null &&
      medication.inventoryAlertThreshold !== null &&
      medication.inventoryCount <= medication.inventoryAlertThreshold,
  );

  let logging = $state(false);

  /**
   * Quick-log from the Medications list.
   *
   * This posts to the dashboard's action from a page that does not own it, so
   * it cannot use `use:enhance` — the card is inside an `<a>` and there is no
   * local form to progressively enhance. It stays a `fetch`, but it now does
   * the two things `enhance` would have done for it and previously did not.
   *
   * It never checked `res.ok`. A dose logged against a medication deleted in
   * another tab returned 404 and the card showed a spinner, then nothing —
   * no toast, no error, no change. The user had every reason to believe the
   * dose was recorded.
   *
   * And it never invalidated. Even a SUCCESSFUL log left "Last taken", the
   * supply-days-left chip, the adherence bar and the sparkline showing
   * pre-log values until the next navigation, so the card actively contradicted
   * the action the user had just taken.
   */
  async function quickLog(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    logging = true;
    try {
      const form = new FormData();
      form.set("medicationId", medication.id);
      form.set("quantity", "1");

      const response = await fetch("/dashboard?/logDose", { method: "POST", body: form });
      const result = deserialize(await response.text()) as ActionResult;

      if (result.type === "success") {
        showToast(`${medication.name} logged`, "success");
        // Re-run this page's load so the card's own stats catch up.
        await invalidateAll();
      } else {
        showToast(actionErrorMessage(result), "error");
      }
    } catch (error) {
      // A network failure never reaches `deserialize`, so it needs its own
      // arm — otherwise it is the one path that stays silent.
      showToast(actionErrorMessage({ type: "error", error } as ActionResult), "error");
    } finally {
      logging = false;
    }
  }
</script>

<!-- The quick-log button is a flex sibling of the link rather than laid over
     it. Absolutely positioned in the top-right corner it sat on the status
     chips, and because it was hidden until hover it was an invisible target
     on a touch screen. In the flow it takes its own column and the link
     narrows to make room, so the two cannot overlap at any width. -->
<div
  class="border-glass-border bg-glass hover:bg-glass-hover flex rounded-xl border backdrop-blur-xl transition-colors"
>
  <a href="/medications/{medication.id}" class="block min-w-0 flex-1 p-4 pr-3">
    <!-- The chips share the name's row while there is room and wrap beneath
         it when there is not: the swatch and name claim 12rem before the
         chips are allowed alongside, which at 320px they never are. -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="flex min-w-0 grow basis-48 items-center gap-4">
        <div
          class="h-10 w-10 shrink-0 rounded-lg"
          style="background: {getMedicationBackground(
            medication.colour,
            medication.colourSecondary,
            medication.pattern,
          )}"
        ></div>
        <div class="min-w-0 flex-1">
          <!-- wrap-break-word: the name column is narrowest beside the log
               button on a phone, and one long word would otherwise run out
               of the link and under it. -->
          <p class="font-medium wrap-break-word">{medication.name}</p>
          <p class="text-text-secondary text-sm">
            {medication.dosageAmount}{medication.dosageUnit} &middot; {medication.form}
            <span class="bg-glass ml-2 rounded-full px-2 py-0.5 text-xs">{medication.category}</span
            >
          </p>
        </div>
      </div>
      {#if muted || refillChip || lowStockChip}
        <div class="flex flex-wrap items-center gap-2">
          {#if muted}
            <span
              class="bg-glass text-text-secondary rounded-full px-2 py-1 text-xs font-medium"
              title="Notifications are off for this medication"
            >
              Muted
            </span>
          {/if}
          {#if refillChip}
            <span
              class="rounded-full px-2 py-1 text-xs font-medium {refillChipClass(
                medication.refillSeverity,
              )}"
            >
              {medication.daysUntilRefill ?? 0}d left
            </span>
          {:else if lowStockChip}
            <span class="bg-warning/15 text-warning rounded-full px-2 py-1 text-xs font-medium"
              >Low: {medication.inventoryCount}</span
            >
          {/if}
        </div>
      {/if}
    </div>

    <!-- Stats row -->
    <div class="text-text-secondary mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {#if medication.lastTakenAt}
        <span>Last taken: <TimeSince date={medication.lastTakenAt} /></span>
      {:else}
        <span>Never taken</span>
      {/if}

      {#if medication.daysUntilRefill !== null}
        <span class={medication.daysUntilRefill <= 7 ? "text-warning" : ""}>
          ~{medication.daysUntilRefill}d supply left
        </span>
      {/if}
    </div>

    <!-- Adherence mini-bar (scheduled meds only) -->
    {#if isScheduled}
      <div class="mt-2 flex items-center gap-2">
        <div class="bg-glass h-1.5 flex-1 overflow-hidden rounded-full">
          <div
            class="h-full rounded-full transition-all"
            style="width: {adherence}%; background: {medication.colour}"
          ></div>
        </div>
        <span class="text-text-muted shrink-0 text-xs tabular-nums">{adherence}%</span>
      </div>
    {/if}

    {#if medication.sparkline && medication.sparkline.length > 1}
      <div class="text-text-muted mt-2 flex items-center gap-2">
        <span class="text-[10px] tracking-wider uppercase">14d</span>
        <div class="flex-1" style="color: {medication.colour}">
          <Sparkline
            values={medication.sparkline}
            color="currentColor"
            height={20}
            ariaLabel="14-day dose count for {medication.name}"
          />
        </div>
      </div>
    {/if}
  </a>

  <!-- Quick log button. Visible text rather than a bare "+", which read as
       "add a medication"; the name leads with that same word so a voice
       command of "click Log" matches it (WCAG 2.5.3). At least 44px each way
       because it is the one control on the card a thumb is aimed at, and
       unconditionally rather than behind a pointer query: `pointer: coarse`
       describes only the primary pointer, so a touchscreen laptop would get
       the small size. -->
  <button
    type="button"
    class="border-border-strong text-accent-ink hover:bg-accent hover:text-accent-fg relative mt-4 mr-4 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center self-start rounded-lg border px-3 text-sm font-medium transition-colors"
    aria-label="Log a dose of {medication.name}"
    disabled={logging}
    onclick={quickLog}
  >
    <!-- The label only hides while the log is in flight, so the button keeps
         its width and the name column beside it does not reflow. -->
    <span class={logging ? "invisible" : ""}>Log</span>
    {#if logging}
      <span
        class="absolute inset-0 m-auto h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      ></span>
    {/if}
  </button>
</div>
