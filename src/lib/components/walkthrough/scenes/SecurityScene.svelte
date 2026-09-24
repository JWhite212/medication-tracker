<script lang="ts">
  // routes/(app)/settings/security/+page.svelte with two-factor enabled.
  import { useMark } from "../marks";
  import FieldBox from "../parts/FieldBox.svelte";

  const mark = useMark();
  const card = "border-glass-border bg-glass rounded-xl border p-6";
  const SESSIONS = [
    { n: 1, expires: "22/10/2026", current: true },
    { n: 2, expires: "15/10/2026", current: false },
  ];
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-6">
  <div class="flex items-center gap-3">
    <span class="text-text-muted text-sm">← Settings</span>
    <span class="text-text-muted">/</span>
    <p class="text-2xl font-bold">Security</p>
  </div>

  <div class={card}>
    <p class="mb-4 text-lg font-semibold">Change Password</p>
    <div class="flex flex-col gap-4">
      <FieldBox label="Current Password" required />
      <FieldBox label="New Password" required />
      <FieldBox label="Confirm New Password" required />
      <span
        class="bg-accent text-accent-fg self-start rounded-lg px-5 py-2.5 text-sm font-medium whitespace-nowrap"
        >Update Password</span
      >
    </div>
  </div>

  <div use:mark={"s.twofa"} class={card}>
    <p class="mb-4 text-lg font-semibold">Two-Factor Authentication</p>
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <span
          class="bg-success/10 text-success rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap"
          >Enabled</span
        >
        <p class="text-text-secondary text-sm">
          Your account is protected with two-factor authentication.
        </p>
      </div>
      <div class="flex flex-col gap-3">
        <FieldBox label="Confirm your password" required />
        <div class="flex items-end gap-3">
          <FieldBox label="Authenticator code" required placeholder="000000" width={232} />
          <span
            class="border-danger-ink/30 text-danger-ink rounded-lg border px-5 py-2.5 text-sm font-medium whitespace-nowrap"
            >Disable 2FA</span
          >
        </div>
      </div>
    </div>
  </div>

  <div class={card}>
    <p class="mb-4 text-lg font-semibold">Active Sessions</p>
    <div class="flex flex-col gap-3">
      {#each SESSIONS as session (session.n)}
        <div
          class="border-glass-border flex items-center justify-between rounded-lg border px-4 py-3"
        >
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium">Session {session.n}</p>
              {#if session.current}
                <span
                  class="bg-accent/10 text-accent-ink rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                  >Current</span
                >
              {/if}
            </div>
            <p class="text-text-muted text-xs">Expires {session.expires}</p>
          </div>
          {#if !session.current}
            <span
              class="border-danger-ink/30 text-danger-ink rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap"
              >Revoke</span
            >
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
