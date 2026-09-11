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

<div
  class="group border-glass-border bg-glass hover:bg-glass-hover relative rounded-xl border backdrop-blur-xl transition-colors"
>
  <a href="/medications/{medication.id}" class="block p-4">
    <div class="flex items-center gap-4">
      <div
        class="h-10 w-10 shrink-0 rounded-lg"
        style="background: {getMedicationBackground(
          medication.colour,
          medication.colourSecondary,
          medication.pattern,
        )}"
      ></div>
      <div class="min-w-0 flex-1">
        <p class="font-medium">{medication.name}</p>
        <p class="text-text-secondary text-sm">
          {medication.dosageAmount}{medication.dosageUnit} &middot; {medication.form}
          <span class="bg-glass ml-2 rounded-full px-2 py-0.5 text-xs">{medication.category}</span>
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {#if medication.notificationsEnabled === false}
          <!-- Explicit === false, not !medication.notificationsEnabled: a row
               that reaches this component without the field (an older cached
               payload, or a narrowed projection added later) would be
               undefined, and the falsy form would render "Muted" on every
               medication. This fails safe instead. -->
          <span
            class="bg-glass text-text-secondary rounded-full px-2 py-1 text-xs font-medium"
            title="Notifications are off for this medication"
          >
            Muted
          </span>
        {/if}
        {#if medication.refillSeverity && medication.refillSeverity !== "ok"}
          <span
            class="rounded-full px-2 py-1 text-xs font-medium {refillChipClass(
              medication.refillSeverity,
            )}"
          >
            {medication.daysUntilRefill ?? 0}d left
          </span>
        {:else if medication.inventoryCount !== null && medication.inventoryAlertThreshold !== null && medication.inventoryCount <= medication.inventoryAlertThreshold}
          <span class="bg-warning/15 text-warning rounded-full px-2 py-1 text-xs font-medium"
            >Low: {medication.inventoryCount}</span
          >
        {/if}
      </div>
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

  <!-- Quick log button -->
  <button
    type="button"
    class="bg-glass text-text-secondary hover:bg-accent hover:text-accent-fg absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg opacity-0 transition-all group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
    aria-label="Quick log {medication.name}"
    disabled={logging}
    onclick={quickLog}
  >
    {#if logging}
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
      ></span>
    {:else}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        class="h-4 w-4"
      >
        <path
          d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z"
        />
      </svg>
    {/if}
  </button>
</div>
