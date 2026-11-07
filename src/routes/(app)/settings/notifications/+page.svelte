<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { untrack } from "svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import { showToast } from "$lib/components/ui/Toast.svelte";
  import { urlBase64ToUint8Array, TEST_PUSH_SHOWN_MESSAGE } from "$lib/utils/push";
  import { toneClass, toneOf } from "$lib/utils/status-tone";
  import { formatTimeSince } from "$lib/utils/time";

  let { data, form } = $props();

  // "Active" and "configured" are states, not verdicts: neutral, whichever way
  // they read. The words carry the difference.
  const STATE_TEXT = toneClass(toneOf("state"), "text");

  let pushSupported = $state(false);
  // Whether this BROWSER holds a push subscription. It drives the
  // Enable/Disable button, because Disable has to remove that subscription
  // whatever the server thinks of it.
  let pushEnabled = $state(false);
  let pushLoading = $state(false);
  // Whether the SERVER holds that subscription for this account, which is
  // what decides whether reminders reach this device. The browser alone
  // cannot say: a rotated endpoint whose re-registration failed (the
  // service worker swallows that), or a subscription another account on this
  // browser registered, both look identical from getSubscription().
  //   "unknown"       nothing confirmed yet, or no subscription to confirm
  //   "registered"    the server accepted this subscription for this account
  //   "other-account" the server answered 409: another account owns it
  //   "unconfirmed"   the request failed, so nothing is claimed either way
  type Registration = "unknown" | "registered" | "other-account" | "unconfirmed";
  let registration = $state<Registration>("unknown");

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
  //
  // Re-seeded only when a stored value actually changes. The push toggle
  // reloads the page data to refresh the delivery card, and a seed that read
  // `data.preferences.*` directly would re-run on every reload and throw away
  // checkbox edits the user has not saved yet. A $derived of a primitive does
  // not notify when the new value is equal, so each writable $derived below
  // recomputes only when its stored value moves.
  const storedOverdueEmail = $derived(data.preferences.overdueEmailReminders);
  const storedOverduePush = $derived(data.preferences.overduePushReminders);
  const storedLowInvEmail = $derived(data.preferences.lowInventoryEmailAlerts);
  const storedLowInvPush = $derived(data.preferences.lowInventoryPushAlerts);
  let overdueEmail = $derived(storedOverdueEmail);
  let overduePush = $derived(storedOverduePush);
  let lowInvEmail = $derived(storedLowInvEmail);
  let lowInvPush = $derived(storedLowInvPush);

  // Read through a $derived for the same reason: the check below reloads the
  // page data when it re-registers, and an effect keyed on `data` itself would
  // then run the check again, forever. The check posts to the server, so the
  // effect depends on the key alone: reading back `pushSupported` after
  // writing it would schedule a second run, and with it a second POST.
  const vapidPublicKey = $derived(data.vapidPublicKey);
  $effect(() => {
    const supported = !!vapidPublicKey && "serviceWorker" in navigator && "PushManager" in window;
    pushSupported = supported;
    if (supported) untrack(() => checkPushStatus()).catch(() => {});
  });

  async function postSubscription(sub: PushSubscription): Promise<Registration> {
    try {
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      if (res.ok) return "registered";
      return res.status === 409 ? "other-account" : "unconfirmed";
    } catch {
      return "unconfirmed";
    }
  }

  // Reconciles this browser's subscription with the server. The subscribe
  // route is an idempotent per-account upsert, so re-posting the existing
  // subscription is how a device that dropped off the server (see the
  // service worker's pushsubscriptionchange handler) registers again.
  async function checkPushStatus() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      registration = "unknown";
      pushEnabled = false;
      return;
    }
    const result = await postSubscription(sub);
    registration = result;
    pushEnabled = true;
    // The delivery card is server data: a re-registration may have changed it.
    if (result === "registered") await invalidateAll();
  }

  async function togglePush() {
    pushLoading = true;
    // Set once the server has accepted a change, so the delivery card (server
    // data) is reloaded whichever way the rest of the toggle goes.
    let changedOnServer = false;
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
          changedOnServer = true;
          await sub.unsubscribe();
        }
        pushEnabled = false;
        registration = "unknown";
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
        const result = await postSubscription(sub);
        if (result !== "registered") {
          showToast("Failed to enable push", "error");
          return;
        }
        changedOnServer = true;
        pushEnabled = true;
        registration = "registered";
        showToast("Push notifications enabled", "success");
      }
    } catch {
      // A rejected subscribe (no push service, permission revoked mid-flight),
      // an unreachable server or a failed unsubscribe used to escape this
      // click handler as an unhandled rejection, with nothing on screen.
      showToast("Couldn't update push notifications on this device", "error");
      // Whatever half-happened, the button follows what the browser now
      // holds. Nothing is re-posted: after a Disable whose browser step failed
      // that would re-register the subscription the user just turned off, so
      // the status claims nothing either way until the next visit checks.
      try {
        const reg = await navigator.serviceWorker.ready;
        pushEnabled = (await reg.pushManager.getSubscription()) !== null;
      } catch {
        // Leave the button as it was.
      }
      registration = "unconfirmed";
    } finally {
      if (changedOnServer) await invalidateAll().catch(() => {});
      pushLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Notifications — MedTracker</title>
</svelte:head>

<!-- The body of the sent-test Alert, handed over only while there is
     something to say: a snippet that renders nothing would still draw an empty
     body. -->
{#snippet confirmation()}
  {#if awaitingConfirmation}
    Waiting for this device to confirm it displayed…
  {:else if confirmed}
    Confirmed displayed on this device.
  {/if}
{/snippet}

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary text-sm">← Settings</a>
    <span class="text-text-muted">/</span>
    <h1 tabindex="-1" class="text-2xl font-bold">Notifications</h1>
  </div>

  <!-- Every "happened" outcome of the preferences and resend forms, announced
       from a region that is on the page before the result arrives. -->
  <div role="status">
    {#if form?.success}
      <Alert tone="happened" title="Notification settings saved." />
    {:else if form?.resendOk && form.alreadyVerified}
      <Alert tone="happened" title="Email already verified." />
    {:else if form?.resendOk}
      <Alert tone="happened" title="Verification email sent.">
        Check your inbox (and spam folder).
      </Alert>
    {/if}
  </div>

  {#if data.emailConfigured && (data.preferences.overdueEmailReminders || data.preferences.lowInventoryEmailAlerts) && !data.emailVerified}
    <!-- Kept in its own card so the resend form does not nest inside the
         preferences form. Not a live region: it is on screen from the first
         paint, and a region around the Resend button would re-announce it. The
         resend's success is announced from the page-level region above, which
         outlives this panel when the reload finds the address already
         verified. -->
    <GlassCard>
      <Alert tone="needs-you" title="Verify your email to enable email reminders.">
        {#snippet action()}
          <form method="POST" action="?/resendVerification" use:enhance>
            <Button variant="secondary" size="sm" type="submit">Resend verification email</Button>
          </form>
        {/snippet}
      </Alert>
      {#if form?.resendError}
        <Alert tone="wrong" title={form.resendError} class="mt-3" />
      {/if}
    </GlassCard>
  {:else if (data.preferences.overdueEmailReminders || data.preferences.lowInventoryEmailAlerts) && !data.emailConfigured}
    <GlassCard>
      <Alert
        tone="neutral"
        title="Email is not configured on this deployment, so email reminders won't be sent."
      />
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
              class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink h-4 w-4 rounded-xs"
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
              class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink h-4 w-4 rounded-xs"
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
              class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink h-4 w-4 rounded-xs"
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
              class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink h-4 w-4 rounded-xs"
            />
          </label>
        </div>
      </fieldset>

      <Button variant="primary" type="submit">Save Changes</Button>
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
            <a class="hover:text-accent-ink underline" href="/medications/{med.id}">{med.name}</a>
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
        <Button
          variant={pushEnabled ? "secondary" : "primary"}
          size="sm"
          onclick={togglePush}
          disabled={pushLoading}
          pending={pushLoading}
          pendingLabel="Updating…">{pushEnabled ? "Disable" : "Enable"}</Button
        >
      </div>
      {#if pushEnabled && registration === "registered"}
        <p class="{STATE_TEXT} mt-3 text-xs">Push notifications are active on this device.</p>
      {:else if pushEnabled && registration === "other-account"}
        <Alert
          tone="needs-you"
          class="mt-3"
          title="This browser's push subscription belongs to another account, so your reminders won't arrive here."
        />
      {:else if pushEnabled && registration === "unconfirmed"}
        <Alert
          tone="needs-you"
          class="mt-3"
          title="Couldn't confirm that this device is registered for push, so reminders may not arrive here."
        >
          Reload this page to try again.
        </Alert>
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
          <dd class={STATE_TEXT}>
            {data.pushHealth.vapidConfigured ? "Configured" : "Not configured on this deployment"}
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-text-muted">Registered devices</dt>
          <dd>
            {data.pushHealth.deviceCount}
            {#if data.pushHealth.oldestRegisteredAt}
              <span class="text-text-muted">
                (oldest {formatTimeSince(
                  new Date(data.pushHealth.oldestRegisteredAt),
                  new Date(),
                  data.preferences.timeSinceDaysFromHours,
                )})
              </span>
            {/if}
          </dd>
        </div>
        <div class="flex items-baseline justify-between gap-4">
          <dt class="text-text-muted">Reminders last processed</dt>
          <dd>
            {#if data.pushHealth.lastReminderAt}
              {formatTimeSince(
                new Date(data.pushHealth.lastReminderAt),
                new Date(),
                data.preferences.timeSinceDaysFromHours,
              )}
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
        <Alert
          tone="needs-you"
          title="Both push preferences above are off, so real reminders won't be sent to these devices."
        >
          A test notification will still arrive.
        </Alert>
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
        <Button
          variant="secondary"
          size="sm"
          type="submit"
          disabled={testing ||
            !data.pushHealth.vapidConfigured ||
            data.pushHealth.deviceCount === 0}
          pending={testing}
          pendingLabel="Sending…">Send test notification</Button
        >
      </form>

      <!-- A failed test is an assertive Alert, so it lives outside the polite
           region below: an assertive region nested in a polite one is what
           Toast.svelte removed. -->
      {#if form?.testError}
        <Alert tone="wrong" title={form.testError} />
      {/if}

      <!-- Polite region for every outcome that is not a failure, kept outside
           the form so the button is not re-announced when the result changes.
           Never hidden while idle: a display:none region leaves the
           accessibility tree, and the result that appears in it may not be
           announced. -->
      <div role="status" class="space-y-2">
        {#if data.pushHealth.vapidConfigured && data.pushHealth.deviceCount === 0}
          <p class="text-text-muted text-xs">
            Enable push on at least one device before running a test.
          </p>
        {/if}
        {#if form?.testOk}
          <Alert
            tone="happened"
            title={form.testMessage}
            children={awaitingConfirmation || confirmed ? confirmation : undefined}
          />
          {#if confirmationTimedOut}
            <Alert
              tone="needs-you"
              title="This device didn't confirm it displayed the notification."
            >
              Check notification permissions for this site in your browser and operating system.
            </Alert>
          {/if}
        {/if}
      </div>
    </div>
  </GlassCard>
</div>
