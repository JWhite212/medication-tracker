<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import { showToast } from "$lib/components/ui/Toast.svelte";

  let { data, form } = $props();

  let pushSupported = $state(false);
  let pushEnabled = $state(false);
  let pushLoading = $state(false);

  $effect(() => {
    pushSupported =
      !!data.vapidPublicKey && "serviceWorker" in navigator && "PushManager" in window;
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
          const res = await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          if (!res.ok) {
            showToast("Failed to disable push", "error");
            return;
          }
          await sub.unsubscribe();
        }
        pushEnabled = false;
        showToast("Push notifications disabled", "success");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          showToast("Notification permission denied", "error");
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: data.vapidPublicKey,
        });
        const res = await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        if (!res.ok) {
          showToast("Failed to enable push", "error");
          return;
        }
        pushEnabled = true;
        showToast("Push notifications enabled", "success");
      }
    } finally {
      pushLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Notifications — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Notifications</h1>
  </div>

  {#if form?.success}
    <p class="bg-success/10 text-success rounded-lg px-4 py-2 text-sm">
      Notification settings saved.
    </p>
  {/if}

  <GlassCard>
    <form method="POST" use:enhance class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Email Reminders</p>
          <p class="text-text-muted text-xs">Receive email when a medication dose is overdue</p>
        </div>
        <input
          type="checkbox"
          name="emailReminders"
          checked={data.preferences.emailReminders}
          class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
        />
      </div>

      {#if data.preferences.emailReminders && !data.emailVerified}
        <div
          class="border-warning/30 bg-warning/5 text-warning rounded-lg border px-4 py-3 text-sm"
          role="status"
        >
          Verify your email to enable email reminders.
          <a href="/auth/verify" class="underline hover:no-underline">Resend verification email</a>.
        </div>
      {:else if data.preferences.emailReminders && !data.emailConfigured}
        <div
          class="border-glass-border bg-surface-raised text-text-secondary rounded-lg border px-4 py-3 text-sm"
          role="status"
        >
          Email is not configured on this deployment, so email reminders won't be sent.
        </div>
      {/if}

      <div class="border-glass-border border-t"></div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm font-medium">Low Inventory Alerts</p>
          <p class="text-text-muted text-xs">
            Get notified when medication stock falls below threshold
          </p>
        </div>
        <input
          type="checkbox"
          name="lowInventoryAlerts"
          checked={data.preferences.lowInventoryAlerts}
          class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
        />
      </div>

      <button
        type="submit"
        class="bg-accent text-accent-fg rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
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
          <p class="text-text-muted text-xs">
            Receive instant push notifications for overdue medications
          </p>
        </div>
        <button
          type="button"
          onclick={togglePush}
          disabled={pushLoading}
          class="rounded-lg px-4 py-2 text-sm font-medium transition-colors {pushEnabled
            ? 'bg-danger/10 text-danger hover:bg-danger/20'
            : 'bg-accent text-accent-fg hover:opacity-90'} disabled:opacity-50"
        >
          {pushLoading ? "Updating..." : pushEnabled ? "Disable" : "Enable"}
        </button>
      </div>
      {#if pushEnabled}
        <p class="text-success mt-3 text-xs">Push notifications are active on this device.</p>
      {/if}
    </GlassCard>
  {/if}
</div>
