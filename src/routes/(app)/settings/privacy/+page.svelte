<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import DestructiveConfirm from "$lib/components/ui/DestructiveConfirm.svelte";
  import { createDestructiveDialog } from "$lib/components/ui/destructive-dialog.svelte";
  import {
    archivedMedicationsSummary,
    doseHistorySummary,
    formatCount,
  } from "$lib/utils/destructive-confirm";

  let { data, form } = $props();

  // Revoke's password field, cleared once its result has landed.
  let revokePassword = $state("");

  // The two wipes are deletions nothing can undo, so each opens the one
  // confirmation dialog; its form sits after the page container (below).
  const doseHistory = createDestructiveDialog();
  const archived = createDestructiveDialog();

  const removedLabel = (n: number, one: string, many: string) =>
    `Removed ${formatCount(n)} ${n === 1 ? one : many}.`;
</script>

<svelte:head>
  <title>Privacy & Data — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary text-sm">← Settings</a>
    <span class="text-text-muted">/</span>
    <h1 tabindex="-1" class="text-2xl font-bold">Privacy & Data</h1>
  </div>

  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">What is stored</h2>
    <p class="text-text-secondary text-sm">
      MedTracker keeps the data you enter directly: your medications, dose history, schedules,
      inventory events, notification preferences, and an audit trail of changes. Sessions are stored
      so you stay signed in across devices. Email addresses are stored for sign-in and reminders
      only.
    </p>
    <h3 class="mt-4 mb-1 text-sm font-medium">Not stored</h3>
    <p class="text-text-secondary text-sm">
      No third-party trackers, no analytics on your dose data, no telemetry sent to MedTracker
      beyond what's needed to render the app. Push notification payloads carry the medication name
      and timing only — they do not include health-related text or notes.
    </p>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">Your data at a glance</h2>
    <dl class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
      <div>
        <dt class="text-text-muted text-xs">Active medications</dt>
        <dd class="text-base font-medium">{data.counts.activeMedications}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Archived medications</dt>
        <dd class="text-base font-medium">{data.counts.archivedMedications}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Dose log entries</dt>
        <dd class="text-base font-medium">{data.counts.doseLogs}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Active sessions</dt>
        <dd class="text-base font-medium">{data.counts.sessions}</dd>
      </div>
      <div>
        <dt class="text-text-muted text-xs">Audit log entries</dt>
        <dd class="text-base font-medium">{data.counts.auditLogs}</dd>
      </div>
    </dl>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-3 text-lg font-semibold">Export</h2>
    <p class="text-text-secondary mb-4 text-sm">
      Download your dose history as a PDF or CSV, or download the audit log as a CSV.
    </p>
    <div class="flex flex-wrap gap-3">
      <Button variant="secondary" href="/api/export?format=pdf">Dose history (PDF)</Button>
      <Button variant="secondary" href="/api/export?format=csv">Dose history (CSV)</Button>
      <Button variant="secondary" href="/api/audit">Audit log (CSV)</Button>
    </div>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-3 text-lg font-semibold">Revoke other sessions</h2>
    <p class="text-text-secondary mb-3 text-sm">
      Sign out every device except this one. Re-enter your password to confirm.
    </p>
    <!-- The region is PERSISTENT and the message appears inside it. A live region
         inserted at the same moment as its content is not reliably announced —
         same shape as the one in settings/notifications. use:enhance means there
         is no navigation, so without this the outcome is silent. Only what
         happened goes in it: an error Alert is role="alert", announces itself,
         and nested in a polite region can be read twice, so it is a sibling. -->
    <div role="status">
      {#if form?.revokeOk}
        <Alert
          class="mb-3"
          tone="happened"
          title={`Revoked ${form.removed} session${form.removed === 1 ? "" : "s"}.`}
        />
      {/if}
    </div>
    {#if form?.revokeError}
      <Alert class="mb-3" tone="wrong" title={form.revokeError} />
    {/if}
    <form
      method="POST"
      action="?/revokeOtherSessions"
      use:enhance={() =>
        async ({ update }) => {
          await update();
          revokePassword = "";
        }}
      class="flex flex-wrap items-end gap-3"
    >
      <label class="flex-1">
        <span class="text-text-muted mb-1 block text-xs">Password</span>
        <input
          type="password"
          name="password"
          autocomplete="current-password"
          bind:value={revokePassword}
          required
          class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      </label>
      <Button variant="secondary" type="submit">Revoke other sessions</Button>
    </form>
  </GlassCard>

  <GlassCard>
    <!-- Neutral: red stays on the irreversible action inside each dialog. Each
         control is described by its section's paragraph, so a screen reader
         that Tabs straight to it still hears what it deletes. -->
    <h2 class="mb-2 text-lg font-semibold">Danger zone</h2>

    <div class="space-y-4">
      <div>
        <h3 class="text-sm font-medium">Delete all dose history</h3>
        <p id="wipe-doses-description" class="text-text-secondary mb-2 text-sm">
          Removes every dose log permanently. Medications and schedules are kept.
        </p>
        <div role="status">
          {#if form?.wipeDosesOk}
            <Alert
              class="mb-2"
              tone="happened"
              title={removedLabel(form.removed, "dose log entry", "dose log entries")}
            />
          {/if}
        </div>
        {#if data.counts.doseLogs > 0}
          <Button
            variant="secondary"
            aria-describedby="wipe-doses-description"
            onclick={doseHistory.show}>Delete dose history</Button
          >
        {:else}
          <p class="text-text-muted text-sm">{doseHistorySummary({ doses: 0, medications: 0 })}</p>
        {/if}
      </div>

      <div class="border-glass-border border-t pt-4">
        <h3 class="text-sm font-medium">Delete archived medications</h3>
        <p id="wipe-archived-description" class="text-text-secondary mb-2 text-sm">
          Permanently removes medications you've archived, along with their dose history and
          schedules.
        </p>
        <div role="status">
          {#if form?.wipeArchivedOk}
            <Alert
              class="mb-2"
              tone="happened"
              title={removedLabel(form.removed, "archived medication", "archived medications")}
            />
          {/if}
        </div>
        {#if data.counts.archivedMedications > 0}
          <Button
            variant="secondary"
            aria-describedby="wipe-archived-description"
            onclick={archived.show}>Delete archived medications</Button
          >
        {:else}
          <p class="text-text-muted text-sm">
            {archivedMedicationsSummary({ medications: 0, doses: 0 })}
          </p>
        {/if}
      </div>

      <div class="border-glass-border border-t pt-4">
        <h3 class="text-sm font-medium">Delete account</h3>
        <p id="delete-account-description" class="text-text-secondary mb-2 text-sm">
          Permanently deletes your account and every record of your data. The confirmation form
          lives on the data management page.
        </p>
        <Button
          variant="secondary"
          href="/settings/data"
          aria-describedby="delete-account-description">Go to delete account</Button
        >
      </div>
    </div>
  </GlassCard>
</div>

<!-- Each dialog renders inside the form it submits, and these forms sit
     outside every GlassCard: backdrop-blur-xl would make a card the
     containing block for Modal's fixed scrim, clipping it to the card. -->
<form method="POST" action="?/wipeDoseHistory" use:enhance={doseHistory.submit}>
  <DestructiveConfirm
    open={doseHistory.open}
    onclose={doseHistory.close}
    title="Delete dose history?"
    summary={doseHistorySummary({
      doses: data.counts.doseLogs,
      medications: data.counts.doseMedications,
    })}
    word="DELETE"
    confirmation={data.confirmation}
    returnTo="/settings/privacy"
    confirmLabel="Delete dose history"
    pending={doseHistory.pending}
    error={doseHistory.error}
  />
</form>
<form method="POST" action="?/wipeArchivedMedications" use:enhance={archived.submit}>
  <DestructiveConfirm
    open={archived.open}
    onclose={archived.close}
    title="Delete archived medications?"
    summary={archivedMedicationsSummary({
      medications: data.counts.archivedMedications,
      doses: data.counts.archivedDoses,
    })}
    word="DELETE"
    confirmation={data.confirmation}
    returnTo="/settings/privacy"
    confirmLabel="Delete archived medications"
    pending={archived.pending}
    error={archived.error}
  />
</form>
