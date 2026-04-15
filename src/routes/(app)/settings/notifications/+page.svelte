<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassCard from '$lib/components/ui/GlassCard.svelte';

  let { data, form } = $props();
</script>

<svelte:head>
  <title>Notifications — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl w-full space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Notifications</h1>
  </div>

  {#if form?.success}
    <p class="rounded-lg bg-success/10 px-4 py-2 text-sm text-success">Notification settings saved.</p>
  {/if}

  <GlassCard>
    <form method="POST" use:enhance class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Email Reminders</p>
          <p class="text-xs text-text-muted">Receive email when a medication dose is overdue</p>
        </div>
        <input
          type="checkbox"
          name="emailReminders"
          checked={data.preferences.emailReminders}
          class="h-4 w-4 rounded border-glass-border bg-surface-raised text-accent focus:ring-accent"
        />
      </div>

      <div class="border-t border-glass-border"></div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Low Inventory Alerts</p>
          <p class="text-xs text-text-muted">Get notified when medication stock falls below threshold</p>
        </div>
        <input
          type="checkbox"
          name="lowInventoryAlerts"
          checked={data.preferences.lowInventoryAlerts}
          class="h-4 w-4 rounded border-glass-border bg-surface-raised text-accent focus:ring-accent"
        />
      </div>

      <button
        type="submit"
        class="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
      >
        Save Changes
      </button>
    </form>
  </GlassCard>
</div>
