<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import GlassCard from '$lib/components/ui/GlassCard.svelte';
  import Input from '$lib/components/ui/Input.svelte';

  let { data, form } = $props();
</script>

<svelte:head>
  <title>Security — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-sm text-text-muted hover:text-text-primary">← Settings</a>
    <span class="text-text-muted">/</span>
    <h1 class="text-2xl font-bold">Security</h1>
  </div>

  <!-- Change Password -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Change Password</h2>

    {#if form?.passwordSuccess}
      <p class="mb-4 rounded-lg bg-success/10 px-4 py-2 text-sm text-success">Password updated successfully.</p>
    {/if}

    <form method="POST" action="?/changePassword" use:enhance class="space-y-4">
      <Input
        label="Current Password"
        name="currentPassword"
        type="password"
        required
        error={form?.passwordErrors?.currentPassword?.[0] ?? ''}
      />
      <Input
        label="New Password"
        name="newPassword"
        type="password"
        required
        error={form?.passwordErrors?.newPassword?.[0] ?? ''}
      />
      <Input
        label="Confirm New Password"
        name="confirmPassword"
        type="password"
        required
        error={form?.passwordErrors?.confirmPassword?.[0] ?? ''}
      />

      <button
        type="submit"
        class="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Update Password
      </button>
    </form>
  </GlassCard>

  <!-- Active Sessions -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Active Sessions</h2>

    <div class="space-y-3">
      {#each data.sessions as session (session.id)}
        <div class="flex items-center justify-between rounded-lg border border-glass-border px-4 py-3">
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">Session</p>
              {#if session.id === data.currentSessionId}
                <span class="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Current</span>
              {/if}
            </div>
            <p class="text-xs text-text-muted">
              Expires {new Date(session.expiresAt).toLocaleDateString()}
            </p>
          </div>

          {#if session.id !== data.currentSessionId}
            <form method="POST" action="?/revokeSession" use:enhance>
              <input type="hidden" name="sessionId" value={session.id} />
              <button
                type="submit"
                class="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
              >
                Revoke
              </button>
            </form>
          {/if}
        </div>
      {/each}

      {#if data.sessions.length === 0}
        <p class="text-sm text-text-muted">No active sessions found.</p>
      {/if}
    </div>
  </GlassCard>

  <!-- Sign Out -->
  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">Sign Out</h2>
    <p class="mb-4 text-sm text-text-muted">Sign out of your current session.</p>

    <form
      method="POST"
      action="?/logout"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'success') {
            await goto('/auth/login');
          }
        };
      }}
    >
      <button
        type="submit"
        class="rounded-lg border border-danger/30 px-5 py-2.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10"
      >
        Sign Out
      </button>
    </form>
  </GlassCard>
</div>
