<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import GlassCard from "$lib/components/ui/GlassCard.svelte";
  import Input from "$lib/components/ui/Input.svelte";
  import { actionErrorMessage } from "$lib/utils/form-errors";
  import { toneClass, toneOf } from "$lib/utils/status-tone";
  import { formatUserDate, type DateFormat } from "$lib/utils/time";

  let { data, form } = $props();

  // "Enabled" is a state, not a verdict: neutral, whatever the setting is.
  const STATE_CHIP = toneClass(toneOf("state"), "chip");
  const SIGN_OUT_FAILED = "Couldn't sign out — please try again.";
  // The sign-out form is enhanced, so its failure never reaches `form`: it
  // is read from the result in the callback and drawn here.
  let signOutError = $state<string | null>(null);

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
    <h1 tabindex="-1" class="text-2xl font-bold">Security</h1>
  </div>

  <!-- Change Password -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Change Password</h2>

    <div role="status">
      {#if form?.passwordSuccess}
        <Alert tone="happened" title="Password updated successfully." class="mb-4" />
      {/if}
    </div>

    <form method="POST" action="?/changePassword" use:enhance class="space-y-4">
      <Input
        label="Current Password"
        name="currentPassword"
        type="password"
        autocomplete="current-password"
        required
        error={passwordErrors.currentPassword?.[0] ?? ""}
      />
      <Input
        label="New Password"
        name="newPassword"
        type="password"
        autocomplete="new-password"
        required
        error={passwordErrors.newPassword?.[0] ?? ""}
      />
      <Input
        label="Confirm New Password"
        name="confirmPassword"
        type="password"
        autocomplete="new-password"
        required
        error={passwordErrors.confirmPassword?.[0] ?? ""}
      />

      <Button variant="primary" type="submit">Update Password</Button>
    </form>
  </GlassCard>

  <!-- Two-Factor Authentication -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Two-Factor Authentication</h2>

    <!-- The failure path below already had role="alert"; only the success paths
         were silent, so enabling or disabling 2FA announced nothing at all. -->
    <div role="status">
      {#if form?.totpEnabled}
        <Alert
          tone="happened"
          title="Two-factor authentication enabled successfully."
          class="mb-4"
        />
      {/if}
      {#if form?.totpDisabled}
        <Alert tone="happened" title="Two-factor authentication disabled." class="mb-4" />
      {/if}
    </div>
    <!-- One unkeyed string for every 2FA action, so each field of whichever
         arm is showing is described by it, and none is marked invalid: the
         disable arm's "Incorrect password" and "Invalid code" arrive the same
         way and the page cannot tell which field they mean. -->
    {#if form?.totpError}
      <Alert tone="wrong" id="totp-error" title={form.totpError} class="mb-4" />
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
          Manual entry: <code class="bg-surface-overlay rounded-xs px-2 py-0.5 text-xs"
            >{form.totpSetup.secret}</code
          >
        </p>
        <form method="POST" action="?/verifyTwoFactor" use:enhance class="flex items-end gap-3">
          <Input
            label="Verification Code"
            id="verifyTotpCode"
            name="code"
            placeholder="000000"
            autocomplete="one-time-code"
            inputmode="numeric"
            required
            describedBy={form?.totpError ? "totp-error" : undefined}
          />
          <Button variant="primary" type="submit">Verify</Button>
        </form>
      </div>
    {:else if data.twoFactorEnabled}
      <!-- 2FA is enabled — show disable option -->
      <div class="space-y-4">
        <div class="flex items-center gap-3">
          <span class="{STATE_CHIP} rounded-md px-2 py-0.5 text-xs font-semibold">Enabled</span>
          <p class="text-text-secondary text-sm">
            Your account is protected with two-factor authentication.
          </p>
        </div>
        <form method="POST" action="?/disableTwoFactor" use:enhance class="space-y-3">
          <!-- `id` is set explicitly because the Change Password form above mounts
               its own `currentPassword` input unconditionally. Without a distinct
               id, both <label for> attributes resolve to that first input and this
               field is left with no accessible name at all. -->
          <Input
            label="Confirm your password"
            id="disable2faPassword"
            name="currentPassword"
            type="password"
            autocomplete="current-password"
            required
            describedBy={form?.totpError ? "totp-error" : undefined}
          />
          <div class="flex items-end gap-3">
            <Input
              label="Authenticator code"
              id="disable2faCode"
              name="code"
              placeholder="000000"
              autocomplete="one-time-code"
              inputmode="numeric"
              required
              describedBy={form?.totpError ? "totp-error" : undefined}
            />
            <Button variant="secondary" type="submit">Disable 2FA</Button>
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
        <!-- Same duplicate-id hazard as the disable form above: this arm also
             co-renders with the unconditional Change Password form. -->
        <Input
          label="Confirm your password"
          id="setup2faPassword"
          name="currentPassword"
          type="password"
          autocomplete="current-password"
          required
          describedBy={form?.totpError ? "totp-error" : undefined}
        />
        <Button variant="primary" type="submit">Set Up 2FA</Button>
      </form>
    {/if}
  </GlassCard>

  <!-- Active Sessions -->
  <GlassCard>
    <h2 class="mb-4 text-lg font-semibold">Active Sessions</h2>

    <!-- A revoke is announced from a region that is on the page before the
         result arrives. A refused revoke is an assertive Alert, so it sits
         OUTSIDE that region: nested in a polite one it would be read twice. -->
    <div role="status">
      {#if form?.sessionRevoked}
        <Alert tone="happened" title="Session revoked." class="mb-4" />
      {/if}
    </div>
    {#if form?.sessionError}
      <Alert tone="wrong" title={form.sessionError} class="mb-4" />
    {/if}

    <div class="space-y-3">
      <!-- The ordinal is visible as well as in the button's name. Expiry date is
           the only other value on the row and it is NOT unique — two sessions
           created on the same day collide — so without it the list offers nine
           identical "Revoke" buttons for a security-sensitive action. Keeping it
           visible also keeps the accessible name matching the visible label. -->
      {#each data.sessions as session, i (session.id)}
        <div
          class="border-glass-border flex items-center justify-between rounded-lg border px-4 py-3"
        >
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">Session {i + 1}</p>
              {#if session.id === data.currentSessionId}
                <span
                  class="bg-accent/10 text-accent-ink rounded-full px-2 py-0.5 text-xs font-medium"
                  >Current</span
                >
              {/if}
            </div>
            <p class="text-text-muted text-xs">
              Expires {formatUserDate(
                new Date(session.expiresAt),
                data.user.timezone,
                data.preferences.dateFormat as DateFormat,
              )}
            </p>
          </div>

          {#if session.id !== data.currentSessionId}
            <form method="POST" action="?/revokeSession" use:enhance>
              <input type="hidden" name="sessionId" value={session.id} />
              <Button
                variant="secondary"
                size="sm"
                type="submit"
                aria-label="Revoke session {i + 1}">Revoke</Button
              >
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
        signOutError = null;
        return async ({ result }) => {
          if (result.type === "success") {
            await goto("/auth/login");
            return;
          }
          // Anything else left the user signed in and the button looking
          // idle, so say so rather than leave them to wonder.
          signOutError = actionErrorMessage(result, SIGN_OUT_FAILED);
        };
      }}
    >
      <Button variant="secondary" type="submit">Sign Out</Button>
    </form>
    {#if signOutError}
      <Alert tone="wrong" title={signOutError} class="mt-4" />
    {/if}
  </GlassCard>
</div>
