<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassCard from '$lib/components/ui/GlassCard.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';

  let { data, form } = $props();
  let showDeleteConfirm = $state(false);
  let deleteConfirmText = $state('');
</script>

<svelte:head>
  <title>Data Management — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl w-full space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary transition-colors">&larr;</a>
    <h1 class="text-2xl font-bold">Data Management</h1>
  </div>

  {#if form?.success}
    <p class="rounded-lg bg-success/10 px-4 py-2 text-sm text-success">Settings saved.</p>
  {/if}

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Export</h2>
    <form method="POST" action="?/updateFormat" use:enhance class="space-y-4">
      <div>
        <label for="exportFormat" class="mb-1 block text-sm font-medium">Default Export Format</label>
        <select
          id="exportFormat"
          name="exportFormat"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="pdf" selected={data.preferences.exportFormat === 'pdf'}>PDF</option>
          <option value="csv" selected={data.preferences.exportFormat === 'csv'}>CSV</option>
        </select>
      </div>

      <button
        type="submit"
        class="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Save Format
      </button>
    </form>

    <div class="mt-4 border-t border-glass-border pt-4">
      <a
        href="/api/export"
        class="inline-flex rounded-lg border border-glass-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover"
      >
        Download Export
      </a>
    </div>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold text-danger">Danger Zone</h2>
    <p class="mb-4 text-sm text-text-secondary">
      Permanently delete your account and all associated data. This action cannot be undone.
    </p>
    <button
      type="button"
      class="rounded-lg border border-danger px-4 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
      onclick={() => (showDeleteConfirm = true)}
    >
      Delete My Account
    </button>
  </GlassCard>
</div>

<Modal open={showDeleteConfirm} onclose={() => (showDeleteConfirm = false)}>
  <h3 class="mb-2 text-lg font-semibold text-danger">Delete Account</h3>
  <p class="mb-4 text-sm text-text-secondary">
    Type <strong>DELETE</strong> to confirm. All your medications, dose history, and settings will be permanently removed.
  </p>
  <input
    type="text"
    bind:value={deleteConfirmText}
    placeholder="Type DELETE"
    class="mb-4 w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger"
  />
  <div class="flex gap-3">
    <button
      type="button"
      class="flex-1 rounded-lg border border-glass-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-glass-hover"
      onclick={() => (showDeleteConfirm = false)}
    >
      Cancel
    </button>
    <form method="POST" action="?/deleteAccount" use:enhance class="flex-1">
      <button
        type="submit"
        disabled={deleteConfirmText !== 'DELETE'}
        class="w-full rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Delete Permanently
      </button>
    </form>
  </div>
</Modal>
