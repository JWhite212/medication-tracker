<script lang="ts">
  import { enhance } from "$app/forms";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Modal from "$lib/components/ui/Modal.svelte";

  let { data, form } = $props();
  let showDeleteConfirm = $state(false);
  let deleteConfirmText = $state("");
  let deletePassword = $state("");
</script>

<svelte:head>
  <title>Data Management — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Data Management</h1>
  </div>

  {#if form?.success}
    <p class="bg-success/10 text-success rounded-lg px-4 py-2 text-sm">Settings saved.</p>
  {/if}

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Export</h2>
    <form method="POST" action="?/updateFormat" use:enhance class="space-y-4">
      <div>
        <label for="exportFormat" class="mb-1 block text-sm font-medium"
          >Default Export Format</label
        >
        <select
          id="exportFormat"
          name="exportFormat"
          class="border-glass-border bg-surface-raised text-text-primary focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
        >
          <option value="pdf" selected={data.preferences.exportFormat === "pdf"}>PDF</option>
          <option value="csv" selected={data.preferences.exportFormat === "csv"}>CSV</option>
        </select>
      </div>

      <button
        type="submit"
        class="bg-accent text-accent-fg rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Save Format
      </button>
    </form>

    <div class="border-glass-border mt-4 border-t pt-4">
      <a
        href="/api/export"
        class="border-glass-border hover:bg-glass-hover inline-flex rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
      >
        Download Export
      </a>
    </div>
  </GlassCard>

  <GlassCard>
    <h2 class="text-danger mb-4 text-lg font-semibold">Danger Zone</h2>
    <p class="text-text-secondary mb-4 text-sm">
      Permanently delete your account and all associated data. This action cannot be undone.
    </p>
    <button
      type="button"
      class="border-danger text-danger hover:bg-danger/10 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
      onclick={() => (showDeleteConfirm = true)}
    >
      Delete My Account
    </button>
  </GlassCard>
</div>

<Modal open={showDeleteConfirm} onclose={() => (showDeleteConfirm = false)}>
  <h3 class="text-danger mb-2 text-lg font-semibold">Delete Account</h3>
  <p class="text-text-secondary mb-4 text-sm">
    Type <strong>DELETE</strong> to confirm. All your medications, dose history, and settings will be
    permanently removed.
  </p>
  {#if form?.deleteError}
    <p class="bg-danger/10 text-danger mb-3 rounded-lg px-4 py-2 text-sm">{form.deleteError}</p>
  {/if}
  <input
    type="text"
    bind:value={deleteConfirmText}
    placeholder="Type DELETE"
    class="border-glass-border bg-surface-raised text-text-primary focus:border-danger focus:ring-danger mb-3 w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
  />
  <input
    type="password"
    bind:value={deletePassword}
    placeholder="Enter your password"
    class="border-glass-border bg-surface-raised text-text-primary focus:border-danger focus:ring-danger mb-4 w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
  />
  <div class="flex gap-3">
    <button
      type="button"
      class="border-glass-border hover:bg-glass-hover flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors"
      onclick={() => (showDeleteConfirm = false)}
    >
      Cancel
    </button>
    <form method="POST" action="?/deleteAccount" use:enhance class="flex-1">
      <input type="hidden" name="password" value={deletePassword} />
      <button
        type="submit"
        disabled={deleteConfirmText !== "DELETE" || !deletePassword}
        class="bg-danger w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Delete Permanently
      </button>
    </form>
  </div>
</Modal>
