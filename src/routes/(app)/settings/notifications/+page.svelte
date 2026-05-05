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

  {#if data.emailConfigured && (data.preferences.overdueEmailReminders || data.preferences.lowInventoryEmailAlerts) && !data.emailVerified}
    <!-- Verify-email hint kept in its own card so the resend form does
         not nest inside the preferences form. -->
    <GlassCard>
      <div
        class="border-warning/30 bg-warning/5 text-warning rounded-lg border px-4 py-3 text-sm"
        role="status"
      >
        <p>Verify your email to enable email reminders.</p>
        {#if form?.resendOk}
          <p class="text-success mt-2">
            {#if form?.alreadyVerified}
              Email already verified.
            {:else}
              Verification email sent. Check your inbox (and spam folder).
            {/if}
          </p>
        {:else if form?.resendError}
          <p class="text-danger mt-2">{form.resendError}</p>
        {/if}
        <form method="POST" action="?/resendVerification" use:enhance class="mt-2">
          <button type="submit" class="text-warning underline transition-colors hover:no-underline">
            Resend verification email
          </button>
        </form>
      </div>
    </GlassCard>
  {:else if (data.preferences.overdueEmailReminders || data.preferences.lowInventoryEmailAlerts) && !data.emailConfigured}
    <GlassCard>
      <div
        class="border-glass-border bg-surface-raised text-text-secondary rounded-lg border px-4 py-3 text-sm"
        role="status"
      >
        Email is not configured on this deployment, so email reminders won't be sent.
      </div>
    </GlassCard>
  {/if}

  <GlassCard>
    <form method="POST" use:enhance class="space-y-6">
      <fieldset class="m-0 border-0 p-0">
        <legend class="text-text-muted mb-3 text-xs font-medium tracking-wider uppercase">
          Overdue dose reminders
        </legend>
        <div class="space-y-4">
          <label class="flex cursor-pointer items-center justify-between">
            <span>
              <span class="block text-sm font-medium">Email</span>
              <span class="text-text-muted block text-xs">
                Receive email when a medication dose is overdue
              </span>
            </span>
            <input
              type="checkbox"
              name="overdueEmailReminders"
              checked={data.preferences.overdueEmailReminders}
              class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
            />
          </label>
          <label class="flex cursor-pointer items-center justify-between">
            <span>
              <span class="block text-sm font-medium">Push</span>
              <span class="text-text-muted block text-xs">
                Send a push notification on this device when a dose is overdue
              </span>
            </span>
            <input
              type="checkbox"
              name="overduePushReminders"
              checked={data.preferences.overduePushReminders}
              class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
            />
          </label>
        </div>
      </fieldset>

      <div class="border-glass-border border-t"></div>

      <fieldset class="m-0 border-0 p-0">
        <legend class="text-text-muted mb-3 text-xs font-medium tracking-wider uppercase">
          Low inventory alerts
        </legend>
        <div class="space-y-4">
          <label class="flex cursor-pointer items-center justify-between">
            <span>
              <span class="block text-sm font-medium">Email</span>
              <span class="text-text-muted block text-xs">
                Email me when medication stock falls below the threshold
              </span>
            </span>
            <input
              type="checkbox"
              name="lowInventoryEmailAlerts"
              checked={data.preferences.lowInventoryEmailAlerts}
              class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
            />
          </label>
          <label class="flex cursor-pointer items-center justify-between">
            <span>
              <span class="block text-sm font-medium">Push</span>
              <span class="text-text-muted block text-xs">
                Send a push notification when stock is low
              </span>
            </span>
            <input
              type="checkbox"
              name="lowInventoryPushAlerts"
              checked={data.preferences.lowInventoryPushAlerts}
              class="border-glass-border bg-surface-raised text-accent focus:ring-accent h-4 w-4 rounded"
            />
          </label>
        </div>
      </fieldset>

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
