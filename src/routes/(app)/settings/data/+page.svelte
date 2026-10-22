<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import DestructiveConfirm from "$lib/components/ui/DestructiveConfirm.svelte";
  import { createDestructiveDialog } from "$lib/components/ui/destructive-dialog.svelte";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";
  import { accountDeletionSummary } from "$lib/utils/destructive-confirm";

  let { data, form } = $props();

  // Account deletion is a deletion nothing can undo, so it opens the one
  // confirmation dialog; its form sits after the page container (below).
  const account = createDestructiveDialog();
</script>

<svelte:head>
  <title>Data Management — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary text-sm">← Settings</a>
    <span class="text-text-muted">/</span>
    <h1 tabindex="-1" class="text-2xl font-bold">Data Management</h1>
  </div>

  <div role="status">
    {#if form?.success}
      <Alert tone="happened" title="Settings saved." />
    {/if}
  </div>

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Export</h2>

    <div class="mb-4">
      <MedicalDisclaimer variant="inline" />
    </div>

    <form method="POST" action="?/updateFormat" use:enhance class="space-y-4">
      <div>
        <label for="exportFormat" class="mb-1 block text-sm font-medium"
          >Default Export Format</label
        >
        <select
          id="exportFormat"
          name="exportFormat"
          class="border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          <option value="pdf" selected={data.preferences.exportFormat === "pdf"}>PDF</option>
          <option value="csv" selected={data.preferences.exportFormat === "csv"}>CSV</option>
        </select>
      </div>

      <Button variant="primary" type="submit">Save Format</Button>
    </form>

    <div class="border-glass-border mt-4 flex flex-wrap gap-3 border-t pt-4">
      <Button variant="secondary" href="/api/export">Download Export</Button>
      <Button variant="secondary" href="/api/export/full">Download Full Backup (JSON)</Button>
    </div>
    <p class="text-text-muted mt-3 text-xs">
      PDF and CSV exports are reports — useful to read or share, but they don't carry everything.
      The full JSON backup is the only format that can be imported back in.
    </p>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">Import</h2>
    <p class="text-text-secondary mb-4 text-sm">
      Restore from a backup, or bring data across from another account. Imports preview what will
      change before anything is written, and merging never overwrites what's already here.
    </p>
    <Button variant="secondary" href="/settings/data/import">Import Data</Button>
  </GlassCard>

  <GlassCard>
    <!-- Neutral: red stays on the irreversible action inside the dialog. -->
    <h2 class="mb-4 text-lg font-semibold">Danger Zone</h2>
    <p id="delete-account-description" class="text-text-secondary mb-4 text-sm">
      Permanently delete your account and all associated data. This action cannot be undone.
    </p>
    <Button variant="secondary" aria-describedby="delete-account-description" onclick={account.show}
      >Delete My Account</Button
    >
  </GlassCard>
</div>

<!-- The dialog renders inside the form it submits, and that form sits outside
     every GlassCard: backdrop-blur-xl would make a card the containing block
     for Modal's fixed scrim, clipping it to the card. -->
<form method="POST" action="?/deleteAccount" use:enhance={account.submit}>
  <DestructiveConfirm
    open={account.open}
    onclose={account.close}
    title="Delete your account?"
    summary={accountDeletionSummary(data.counts)}
    word="DELETE"
    confirmation={data.confirmation}
    returnTo="/settings/data"
    confirmLabel="Delete account"
    pending={account.pending}
    error={account.error}
  />
</form>
