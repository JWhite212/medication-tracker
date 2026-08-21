<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import { showToast } from "$lib/components/ui/Toast.svelte";
  import { urlBase64ToUint8Array, TEST_PUSH_SHOWN_MESSAGE } from "$lib/utils/push";
  import { formatTimeSince } from "$lib/utils/time";

  let { data, form } = $props();

  let pushSupported = $state(false);
  let pushEnabled = $state(false);
  let pushLoading = $state(false);

  // How long to wait for this device's service worker to report that it
  // actually displayed the test before assuming it was suppressed.
  const CONFIRM_TIMEOUT_MS = 10_000;

  let testing = $state(false);
  let confirmed = $state(false);
  let awaitingConfirmation = $state(false);
  let confirmationTimedOut = $state(false);
  // Deliberately not $state: the timer handle is bookkeeping, and making
  // it reactive would re-run the listener effect on every send.
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;

  // The service worker posts here once showNotification() resolves for a
  // test push, which is the only evidence available that the OS did not
  // swallow it. Registered once — this effect reads no reactive state.
  $effect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== TEST_PUSH_SHOWN_MESSAGE) return;
      clearTimeout(confirmTimer);
      confirmed = true;
      awaitingConfirmation = false;
      confirmationTimedOut = false;
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      clearTimeout(confirmTimer);
    };
  });

  function startConfirmationWindow() {
    clearTimeout(confirmTimer);
    confirmed = false;
    confirmationTimedOut = false;
    awaitingConfirmation = true;
    confirmTimer = setTimeout(() => {
      awaitingConfirmation = false;
      confirmationTimedOut = true;
    }, CONFIRM_TIMEOUT_MS);
  }

  // Local two-way bound state seeded from the server payload.
  // Plain `checked={...}` is a one-way binding in Svelte 5 — clicking
  // the checkbox flipped the DOM value but the next reactive tick
  // re-synced the DOM back to the original prop, so toggles felt
  // unresponsive. bind:checked makes the visible state the source of
  // truth for what the form submits.
  let overdueEmail = $state(data.preferences.overdueEmailReminders);
  let overduePush = $state(data.preferences.overduePushReminders);
  let lowInvEmail = $state(data.preferences.lowInventoryEmailAlerts);
  let lowInvPush = $state(data.preferences.lowInventoryPushAlerts);

  $effect(() => {
    overdueEmail = data.preferences.overdueEmailReminders;
    overduePush = data.preferences.overduePushReminders;
    lowInvEmail = data.preferences.lowInventoryEmailAlerts;
    lowInvPush = data.preferences.lowInventoryPushAlerts;
  });

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
        // Guarded by `pushSupported` (which requires a VAPID key) before
        // this button renders, but narrow it explicitly for the subscribe
        // call below.
        if (!data.vapidPublicKey) return;
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          showToast("Notification permission denied", "error");
          return;
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.vapidPublicKey),
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
         not nest inside the preferences form. The interactive form sits
         OUTSIDE the role="status" announcement so screen readers don't
         re-announce the button when its surrounding text re-renders. -->
    <GlassCard>
      <div class="border-warning/30 bg-warning/5 rounded-lg border px-4 py-3 text-sm">
        <p class="text-warning" role="status">Verify your email to enable email reminders.</p>
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
          <button
            type="submit"
            class="text-warning cursor-pointer underline transition-colors hover:no-underline"
          >
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
    <form method="POST" action="?/savePrefs" use:enhance class="space-y-6">
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
              bind:checked={overdueEmail}
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
              bind:checked={overduePush}
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
              bind:checked={lowInvEmail}
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
              bind:checked={lowInvPush}
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

  {#if data.mutedMedications.length > 0}
    <GlassCard>
      <h2 class="mb-2 text-lg font-semibold">Muted medications</h2>
      <p class="text-text-secondary mb-3 text-sm">
        These medications ignore the settings above. Change them on the medication itself.
      </p>
      <ul class="space-y-1 text-sm">
        {#each data.mutedMedications as med (med.id)}
          <li>
            <a class="hover:text-accent underline" href="/medications/{med.id}">{med.name}</a>
          </li>
        {/each}
      </ul>
    </GlassCard>
  {/if}

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

  <!-- Account-wide delivery diagnostics. Rendered from server data, so
       unlike the card above it does not depend on this browser
       supporting push — a user on an unsupported browser can still see
       that their phone is registered. -->
  <GlassCard>
    <div class="space-y-4">
      <div>
        <p class="text-sm font-medium">Notification delivery</p>
        <p class="text-text-muted text-xs">
          Check that notifications reach your devices without waiting for a dose to fall due.
        </p>
      </div>

      <dl class="space-y-2 text-xs">
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-text-muted">Push service</dt>
          <dd class={data.pushHealth.vapidConfigured ? "text-success" : "text-warning"}>
            {data.pushHealth.vapidConfigured ? "Configured" : "Not configured on this deployment"}
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-text-muted">Registered devices</dt>
          <dd>
            {data.pushHealth.deviceCount}
            {#if data.pushHealth.oldestRegisteredAt}
              <span class="text-text-muted">
                (oldest {formatTimeSince(new Date(data.pushHealth.oldestRegisteredAt))})
              </span>
            {/if}
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-text-muted">Reminders last processed</dt>
          <dd>
            {#if data.pushHealth.lastReminderAt}
              {formatTimeSince(new Date(data.pushHealth.lastReminderAt))}
            {:else}
              <span class="text-text-muted">None yet</span>
            {/if}
          </dd>
        </div>
      </dl>

      {#if !data.pushHealth.lastReminderAt}
        <p class="text-text-muted text-xs">
          You haven't been sent a reminder yet. That's expected if no dose has fallen overdue since
          you signed up.
        </p>
      {/if}

      {#if data.pushHealth.deviceCount > 0 && !data.preferences.overduePushReminders && !data.preferences.lowInventoryPushAlerts}
        <p class="text-warning text-xs">
          Both push preferences above are off, so real reminders won't be sent to these devices. A
          test notification will still arrive.
        </p>
      {/if}

      <form
        method="POST"
        action="?/sendTest"
        use:enhance={() => {
          testing = true;
          confirmed = false;
          confirmationTimedOut = false;
          awaitingConfirmation = false;
          return async ({ result, update }) => {
            await update({ reset: false });
            testing = false;
            // Only the device running this page can report back, and
            // only if it holds a subscription of its own.
            if (result.type === "success" && pushEnabled) startConfirmationWindow();
          };
        }}
      >
        <button
          type="submit"
          disabled={testing ||
            !data.pushHealth.vapidConfigured ||
            data.pushHealth.deviceCount === 0}
          class="bg-accent text-accent-fg rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testing ? "Sending..." : "Send test notification"}
        </button>
      </form>

      <!-- Single live region for every outcome, kept outside the form so
           the button is not re-announced when the result changes. -->
      <div role="status" class="space-y-1 empty:hidden">
        {#if data.pushHealth.vapidConfigured && data.pushHealth.deviceCount === 0}
          <p class="text-text-muted text-xs">
            Enable push on at least one device before running a test.
          </p>
        {/if}
        {#if form?.testError}
          <p class="text-danger text-xs">{form.testError}</p>
        {:else if form?.testOk}
          <p class="text-success text-xs">{form.testMessage}</p>
          {#if awaitingConfirmation}
            <p class="text-text-muted text-xs">Waiting for this device to confirm it displayed…</p>
          {:else if confirmed}
            <p class="text-success text-xs">Confirmed displayed on this device.</p>
          {:else if confirmationTimedOut}
            <p class="text-warning text-xs">
              This device didn't confirm it displayed the notification. Check notification
              permissions for this site in your browser and operating system.
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </GlassCard>
</div>
