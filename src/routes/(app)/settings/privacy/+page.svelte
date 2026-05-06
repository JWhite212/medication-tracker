<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";

  let { data, form } = $props();

  // Local password values per form. Each form clears its own field
  // on success.
  let wipeDosesPassword = $state("");
  let wipeArchivedPassword = $state("");
  let revokePassword = $state("");
</script>

<svelte:head>
  <title>Privacy & Data — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Privacy & Data</h1>
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
      <a
        href="/api/export?format=pdf"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
      >
        Dose history (PDF)
      </a>
      <a
        href="/api/export?format=csv"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
      >
        Dose history (CSV)
      </a>
      <a
        href="/api/audit"
        class="border-glass-border hover:bg-glass-hover rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
      >
        Audit log (CSV)
      </a>
    </div>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-3 text-lg font-semibold">Revoke other sessions</h2>
    <p class="text-text-secondary mb-3 text-sm">
      Sign out every device except this one. Re-enter your password to confirm.
    </p>
    {#if form?.revokeOk}
      <p class="bg-success/10 text-success mb-3 rounded-lg px-4 py-2 text-sm">
        Revoked {form.removed} session{form.removed === 1 ? "" : "s"}.
      </p>
    {:else if form?.revokeError}
      <p class="bg-danger/10 text-danger mb-3 rounded-lg px-4 py-2 text-sm">{form.revokeError}</p>
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
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        class="border-warning text-warning hover:bg-warning/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
      >
        Revoke other sessions
      </button>
    </form>
  </GlassCard>

  <GlassCard>
    <h2 class="text-warning mb-2 text-lg font-semibold">Danger zone</h2>

    <div class="space-y-4">
      <div>
        <h3 class="text-sm font-medium">Delete all dose history</h3>
        <p class="text-text-secondary mb-2 text-sm">
          Removes every dose log permanently. Medications and schedules are kept.
        </p>
        {#if form?.wipeDosesOk}
          <p class="bg-success/10 text-success mb-2 rounded-lg px-4 py-2 text-sm">
            Removed {form.removed} dose log entr{form.removed === 1 ? "y" : "ies"}.
          </p>
        {:else if form?.wipeDosesError}
          <p class="bg-danger/10 text-danger mb-2 rounded-lg px-4 py-2 text-sm">
            {form.wipeDosesError}
          </p>
        {/if}
        <form
          method="POST"
          action="?/wipeDoseHistory"
          use:enhance={() =>
            async ({ update }) => {
              await update();
              wipeDosesPassword = "";
            }}
          class="flex flex-wrap items-end gap-3"
        >
          <label class="flex-1">
            <span class="text-text-muted mb-1 block text-xs">Password</span>
            <input
              type="password"
              name="password"
              autocomplete="current-password"
              bind:value={wipeDosesPassword}
              required
              class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            class="border-danger text-danger hover:bg-danger/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Delete dose history
          </button>
        </form>
      </div>

      <div class="border-glass-border border-t pt-4">
        <h3 class="text-sm font-medium">Delete archived medications</h3>
        <p class="text-text-secondary mb-2 text-sm">
          Permanently removes medications you've archived, along with their dose history and
          schedules.
        </p>
        {#if form?.wipeArchivedOk}
          <p class="bg-success/10 text-success mb-2 rounded-lg px-4 py-2 text-sm">
            Removed {form.removed} archived medication{form.removed === 1 ? "" : "s"}.
          </p>
        {:else if form?.wipeArchivedError}
          <p class="bg-danger/10 text-danger mb-2 rounded-lg px-4 py-2 text-sm">
            {form.wipeArchivedError}
          </p>
        {/if}
        <form
          method="POST"
          action="?/wipeArchivedMedications"
          use:enhance={() =>
            async ({ update }) => {
              await update();
              wipeArchivedPassword = "";
            }}
          class="flex flex-wrap items-end gap-3"
        >
          <label class="flex-1">
            <span class="text-text-muted mb-1 block text-xs">Password</span>
            <input
              type="password"
              name="password"
              autocomplete="current-password"
              bind:value={wipeArchivedPassword}
              required
              class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            class="border-danger text-danger hover:bg-danger/10 rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
          >
            Delete archived medications
          </button>
        </form>
      </div>

      <div class="border-glass-border border-t pt-4">
        <h3 class="text-sm font-medium">Delete account</h3>
        <p class="text-text-secondary mb-2 text-sm">
          Permanently deletes your account and every record of your data. The confirmation form
          lives on the data management page.
        </p>
        <a
          href="/settings/data"
          class="border-danger text-danger hover:bg-danger/10 inline-flex rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
        >
          Go to delete account
        </a>
      </div>
    </div>
  </GlassCard>
</div>
