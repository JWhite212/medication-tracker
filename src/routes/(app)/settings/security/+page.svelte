<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Input from "$lib/components/ui/Input.svelte";

  let { data, form } = $props();

  type FormErrors = Record<string, string[] | undefined>;
  const passwordErrors = $derived((form?.passwordErrors ?? {}) as FormErrors);
</script>

<svelte:head>
  <title>Security — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="/settings" class="text-text-muted hover:text-text-primary text-sm">← Settings</a>
    <span class="text-text-muted">/</span>
    <h1 class="text-2xl font-bold">Security</h1>
  </div>

  <!-- Change Password -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Change Password</h2>

    {#if form?.passwordSuccess}
      <p class="bg-success/10 text-success mb-4 rounded-lg px-4 py-2 text-sm">
        Password updated successfully.
      </p>
    {/if}

    <form method="POST" action="?/changePassword" use:enhance class="space-y-4">
      <Input
        label="Current Password"
        name="currentPassword"
        type="password"
        required
        error={passwordErrors.currentPassword?.[0] ?? ""}
      />
      <Input
        label="New Password"
        name="newPassword"
        type="password"
        required
        error={passwordErrors.newPassword?.[0] ?? ""}
      />
      <Input
        label="Confirm New Password"
        name="confirmPassword"
        type="password"
        required
        error={passwordErrors.confirmPassword?.[0] ?? ""}
      />

      <button
        type="submit"
        class="bg-accent text-accent-fg rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
      >
        Update Password
      </button>
    </form>
  </GlassCard>

  <!-- Two-Factor Authentication -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Two-Factor Authentication</h2>

    {#if form?.totpEnabled}
      <p class="bg-success/10 text-success mb-4 rounded-lg px-4 py-2 text-sm">
        Two-factor authentication enabled successfully.
      </p>
    {/if}
    {#if form?.totpDisabled}
      <p class="bg-success/10 text-success mb-4 rounded-lg px-4 py-2 text-sm">
        Two-factor authentication disabled.
      </p>
    {/if}
    {#if form?.totpError}
      <p class="bg-danger/10 text-danger mb-4 rounded-lg px-4 py-2 text-sm" role="alert">
        {form.totpError}
      </p>
    {/if}

    {#if form?.totpSetup}
      <!-- Step 2: Scan QR and verify -->
      <div class="space-y-4">
        <p class="text-text-secondary text-sm">
          Scan this QR code with your authenticator app, then enter the 6-digit code to verify.
        </p>
        <div class="flex justify-center">
          <img
            src={form.totpSetup.qrCode}
            alt="TOTP QR Code"
            class="rounded-lg"
            width="200"
            height="200"
          />
        </div>
        <p class="text-text-muted text-center text-xs">
          Manual entry: <code class="bg-surface-overlay rounded px-2 py-0.5 text-xs"
            >{form.totpSetup.secret}</code
          >
        </p>
        <form method="POST" action="?/verifyTwoFactor" use:enhance class="flex items-end gap-3">
          <Input label="Verification Code" name="code" placeholder="000000" required />
          <button
            type="submit"
            class="bg-accent text-accent-fg rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Verify
          </button>
        </form>
      </div>
    {:else if data.twoFactorEnabled}
      <!-- 2FA is enabled — show disable option -->
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <span class="bg-success/10 text-success rounded-full px-3 py-1 text-xs font-medium"
            >Enabled</span
          >
          <p class="text-text-secondary text-sm">
            Your account is protected with two-factor authentication.
          </p>
        </div>
        <form method="POST" action="?/disableTwoFactor" use:enhance class="space-y-3">
          <Input label="Confirm your password" name="currentPassword" type="password" required />
          <div class="flex items-end gap-3">
            <Input label="Authenticator code" name="code" placeholder="000000" required />
            <button
              type="submit"
              class="border-danger/30 text-danger hover:bg-danger/10 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
            >
              Disable 2FA
            </button>
          </div>
        </form>
      </div>
    {:else}
      <!-- Step 1: Setup -->
      <p class="text-text-secondary mb-4 text-sm">
        Add an extra layer of security by requiring a code from your authenticator app when signing
        in.
      </p>
      <form method="POST" action="?/setupTwoFactor" use:enhance class="space-y-4">
        <Input label="Confirm your password" name="currentPassword" type="password" required />
        <button
          type="submit"
          class="bg-accent text-accent-fg rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
        >
          Set Up 2FA
        </button>
      </form>
    {/if}
  </GlassCard>

  <!-- Active Sessions -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Active Sessions</h2>

    <div class="space-y-3">
      {#each data.sessions as session (session.id)}
        <div
          class="border-glass-border flex items-center justify-between rounded-lg border px-4 py-3"
        >
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">Session</p>
              {#if session.id === data.currentSessionId}
                <span class="bg-accent/10 text-accent rounded-full px-2 py-0.5 text-xs font-medium"
                  >Current</span
                >
              {/if}
            </div>
            <p class="text-text-muted text-xs">
              Expires {new Date(session.expiresAt).toLocaleDateString()}
            </p>
          </div>

          {#if session.id !== data.currentSessionId}
            <form method="POST" action="?/revokeSession" use:enhance>
              <input type="hidden" name="sessionId" value={session.id} />
              <button
                type="submit"
                class="border-danger/30 text-danger hover:bg-danger/10 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              >
                Revoke
              </button>
            </form>
          {/if}
        </div>
      {/each}

      {#if data.sessions.length === 0}
        <p class="text-text-muted text-sm">No active sessions found.</p>
      {/if}
    </div>
  </GlassCard>

  <!-- Sign Out -->
  <GlassCard>
    <h2 class="mb-2 text-lg font-semibold">Sign Out</h2>
    <p class="text-text-muted mb-4 text-sm">Sign out of your current session.</p>

    <form
      method="POST"
      action="?/logout"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === "success") {
            await goto("/auth/login");
          }
        };
      }}
    >
      <button
        type="submit"
        class="border-danger/30 text-danger hover:bg-danger/10 rounded-lg border px-5 py-2.5 text-sm font-medium transition-colors"
      >
        Sign Out
      </button>
    </form>
  </GlassCard>
</div>
