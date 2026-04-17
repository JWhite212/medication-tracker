<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassCard from '$lib/components/ui/GlassCard.svelte';
  import { showToast } from '$lib/components/ui/Toast.svelte';

  let { data, form } = $props();

  let pushSupported = $state(false);
  let pushEnabled = $state(false);
  let pushLoading = $state(false);

  $effect(() => {
    pushSupported = !!data.vapidPublicKey && 'serviceWorker' in navigator && 'PushManager' in window;
    if (pushSupported) checkPushStatus().catch(() => {});
  });

  async function checkPushStatus() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    pushEnabled = sub !== null;
  }

  async function togglePush() {
    pushLoading = true;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (pushEnabled) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const res = await fetch('/api/push/unsubscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (!res.ok) { showToast('Failed to disable push', 'error'); return; }
          await sub.unsubscribe();
        }
        pushEnabled = false;
        showToast('Push notifications disabled', 'success');
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          showToast('Notification permission denied', 'error');
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: data.vapidPublicKey,
        });
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) { showToast('Failed to enable push', 'error'); return; }
        pushEnabled = true;
        showToast('Push notifications enabled', 'success');
      }
    } finally {
      pushLoading = false;
    }
  }
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

  {#if pushSupported}
    <GlassCard>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Push Notifications</p>
          <p class="text-xs text-text-muted">Receive instant push notifications for overdue medications</p>
        </div>
        <button
          type="button"
          onclick={togglePush}
          disabled={pushLoading}
          class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {pushEnabled ? 'bg-danger/10 text-danger hover:bg-danger/20' : 'bg-accent text-accent-fg hover:opacity-90'} disabled:opacity-50"
        >
          {pushLoading ? 'Updating...' : pushEnabled ? 'Disable' : 'Enable'}
        </button>
      </div>
      {#if pushEnabled}
        <p class="mt-3 text-xs text-success">Push notifications are active on this device.</p>
      {/if}
    </GlassCard>
  {/if}
</div>
