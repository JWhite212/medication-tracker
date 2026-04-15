<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassCard from '$lib/components/ui/GlassCard.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let { data, form } = $props();

  const timezones = Intl.supportedValuesOf('timeZone');
</script>

<svelte:head>
  <title>Settings — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <h1 class="text-2xl font-bold">Settings</h1>

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Profile</h2>

    {#if form?.success}
      <p class="mb-4 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">Settings saved successfully.</p>
    {/if}

    <form method="POST" use:enhance class="space-y-4">
      <Input
        label="Display Name"
        name="name"
        value={data.user.name}
        required
        error={form?.errors?.name?.[0] ?? ''}
      />

      <div>
        <label for="timezone" class="mb-1 block text-sm font-medium">Timezone</label>
        <select
          id="timezone"
          name="timezone"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        >
          {#each timezones as tz}
            <option value={tz} selected={tz === data.user.timezone}>{tz}</option>
          {/each}
        </select>
        {#if form?.errors?.timezone?.[0]}
          <p class="mt-1 text-sm text-danger">{form.errors.timezone[0]}</p>
        {/if}
      </div>

      <button
        type="submit"
        class="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Save Changes
      </button>
    </form>
  </GlassCard>

  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Account</h2>
    <div class="space-y-3">
      <a
        href="/settings/security"
        class="flex items-center justify-between rounded-lg border border-glass-border px-4 py-3 transition-colors hover:bg-surface-raised"
      >
        <div>
          <p class="font-medium">Security</p>
          <p class="text-sm text-text-muted">Password and active sessions</p>
        </div>
        <span class="text-text-muted">›</span>
      </a>

      <a
        href="/settings/appearance"
        class="flex items-center justify-between rounded-lg border border-glass-border px-4 py-3 transition-colors hover:bg-surface-raised"
      >
        <div>
          <p class="font-medium">Appearance</p>
          <p class="text-sm text-text-muted">Colours, date format, and display density</p>
        </div>
        <span class="text-text-muted">›</span>
      </a>

      <a
        href="/settings/notifications"
        class="flex items-center justify-between rounded-lg border border-glass-border px-4 py-3 transition-colors hover:bg-surface-raised"
      >
        <div>
          <p class="font-medium">Notifications</p>
          <p class="text-sm text-text-muted">Email reminders and alerts</p>
        </div>
        <span class="text-text-muted">›</span>
      </a>

      <a
        href="/settings/data"
        class="flex items-center justify-between rounded-lg border border-glass-border px-4 py-3 transition-colors hover:bg-surface-raised"
      >
        <div>
          <p class="font-medium">Data Management</p>
          <p class="text-sm text-text-muted">Export, import, and account deletion</p>
        </div>
        <span class="text-text-muted">›</span>
      </a>
    </div>
  </GlassCard>
</div>
