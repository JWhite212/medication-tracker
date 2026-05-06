<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import MedicationForm from "$lib/components/MedicationForm.svelte";

  let { data, form } = $props();

  const EVENT_LABELS: Record<string, string> = {
    dose_taken: "Dose taken",
    dose_deleted: "Dose deleted",
    dose_quantity_updated: "Dose quantity edited",
    manual_adjustment: "Manual adjustment",
    refill: "Refill",
    correction: "Correction",
  };

  function formatEventTime(iso: Date | string): string {
    const d = typeof iso === "string" ? new Date(iso) : iso;
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
</script>

<svelte:head>
  <title>Edit {data.medication.name} — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Edit {data.medication.name}</h1>

  <GlassCard>
    <MedicationForm
      medication={data.medication}
      schedules={data.schedules}
      errors={form?.errors ?? {}}
      formValues={(form?.values ?? {}) as Record<string, string>}
    />
  </GlassCard>

  <GlassCard>
    <h2 class="mb-1 text-lg font-semibold">Inventory</h2>
    <p class="text-text-secondary mb-4 text-sm">
      Current count:
      {#if data.medication.inventoryCount === null}
        <span class="text-text-muted">not tracked</span>
      {:else}
        <strong>{data.medication.inventoryCount}</strong> doses
      {/if}
    </p>

    {#if form?.refillOk}
      <p class="bg-success/10 text-success mb-4 rounded-lg px-4 py-2 text-sm">
        Refill recorded. New count: {form.newCount}.
      </p>
    {:else if form?.refillError}
      <p class="bg-danger/10 text-danger mb-4 rounded-lg px-4 py-2 text-sm">
        {form.refillError}
      </p>
    {/if}

    {#if form?.adjustOk}
      <p class="bg-success/10 text-success mb-4 rounded-lg px-4 py-2 text-sm">
        Adjustment recorded. New count: {form.newCount} ({form.quantityChange > 0
          ? "+"
          : ""}{form.quantityChange}).
      </p>
    {:else if form?.adjustError}
      <p class="bg-danger/10 text-danger mb-4 rounded-lg px-4 py-2 text-sm">
        {form.adjustError}
      </p>
    {/if}

    <form
      method="POST"
      action="?/refill"
      use:enhance
      class="grid gap-3 sm:grid-cols-[auto_1fr_auto]"
    >
      <div>
        <label for="refillQuantity" class="text-text-muted mb-1 block text-xs">Quantity</label>
        <input
          id="refillQuantity"
          name="quantity"
          type="number"
          min="1"
          step="1"
          required
          placeholder="30"
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-32 rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      </div>
      <div>
        <label for="refillNote" class="text-text-muted mb-1 block text-xs">Note (optional)</label>
        <input
          id="refillNote"
          name="note"
          type="text"
          maxlength="200"
          placeholder="e.g. picked up at pharmacy"
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        class="bg-accent text-accent-fg self-end rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Mark as refilled
      </button>
    </form>

    <details class="border-glass-border mt-4 border-t pt-4">
      <summary
        class="text-text-secondary hover:text-text-primary cursor-pointer text-sm font-medium"
      >
        Manual adjustment
      </summary>
      <p class="text-text-muted mt-2 mb-3 text-xs">
        Set the inventory to an exact count — for example after a spillage, lost stock, or
        reconciling a miscount. Logs a <strong>manual_adjustment</strong> event with the signed delta.
      </p>
      <form
        method="POST"
        action="?/adjust"
        use:enhance
        class="grid gap-3 sm:grid-cols-[auto_1fr_auto]"
      >
        <div>
          <label for="adjustNewCount" class="text-text-muted mb-1 block text-xs">New count</label>
          <input
            id="adjustNewCount"
            name="newCount"
            type="number"
            min="0"
            step="1"
            required
            placeholder={data.medication.inventoryCount?.toString() ?? "0"}
            class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-32 rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          />
        </div>
        <div>
          <label for="adjustNote" class="text-text-muted mb-1 block text-xs">Note (optional)</label>
          <input
            id="adjustNote"
            name="note"
            type="text"
            maxlength="200"
            placeholder="e.g. spilled 4 pills"
            class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          class="border-warning text-warning hover:bg-warning/10 self-end rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
        >
          Adjust
        </button>
      </form>
    </details>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-3 text-lg font-semibold">Inventory history</h2>
    {#if data.inventoryHistory.length === 0}
      <p class="text-text-secondary text-sm">
        No inventory events yet. Log a dose or refill to see history here.
      </p>
    {:else}
      <ol class="divide-glass-border space-y-0 divide-y" role="list">
        {#each data.inventoryHistory as event (event.id)}
          <li class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <div class="min-w-0">
              <p class="text-sm font-medium">
                {EVENT_LABELS[event.eventType] ?? event.eventType}
                <span
                  class="ml-1 text-xs font-semibold {event.quantityChange > 0
                    ? 'text-success'
                    : event.quantityChange < 0
                      ? 'text-warning'
                      : 'text-text-muted'}"
                >
                  {event.quantityChange > 0 ? "+" : ""}{event.quantityChange}
                </span>
              </p>
              {#if event.note}
                <p class="text-text-secondary mt-0.5 text-xs">{event.note}</p>
              {/if}
              <p class="text-text-muted mt-0.5 text-xs">
                {formatEventTime(event.createdAt)}
                {#if event.previousCount !== null && event.newCount !== null}
                  · {event.previousCount} &rarr; {event.newCount}
                {/if}
              </p>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </GlassCard>

  <GlassCard>
    <div class="flex items-center justify-between">
      {#if data.medication.isArchived}
        <div>
          <p class="font-medium">Archived Medication</p>
          <p class="text-text-secondary text-sm">Restore this medication to your active list.</p>
        </div>
        <form method="POST" action="?/unarchive">
          <button
            type="submit"
            class="border-accent text-accent hover:bg-accent/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Unarchive
          </button>
        </form>
      {:else}
        <div>
          <p class="font-medium">Archive Medication</p>
          <p class="text-text-secondary text-sm">Remove this medication from your active list.</p>
        </div>
        <form method="POST" action="?/archive">
          <button
            type="submit"
            class="border-danger text-danger hover:bg-danger/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Archive
          </button>
        </form>
      {/if}
    </div>
  </GlassCard>
</div>
