<script lang="ts">
  // routes/(app)/settings/security/+page.svelte with two-factor enabled.
  import { toneClass, toneOf } from "$lib/utils/status-tone";
  import { formatUserDate } from "$lib/utils/time";
  import { SESSION_EXPIRIES, WALKTHROUGH_TZ } from "../demo-data";
  import { useMark } from "../marks";
  import FieldBox from "../parts/FieldBox.svelte";
  import { stageButton } from "../parts/stage-controls";

  const mark = useMark();
  const card = "border-glass-border bg-glass rounded-xl border p-6";
  // The real page formats each expiry with the user's dateFormat; the demo
  // account keeps the default.
  const SESSIONS = SESSION_EXPIRIES.map((expiresAt, i) => ({
    n: i + 1,
    expires: formatUserDate(expiresAt, WALKTHROUGH_TZ, "DD/MM/YYYY"),
    current: i === 0,
  }));
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
      <span class="{stageButton('primary')} self-start">Update Password</span>
    </div>
  </div>

  <div use:mark={"s.twofa"} class={card}>
    <p class="mb-4 text-lg font-semibold">Two-Factor Authentication</p>
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <!-- "Enabled" is a state, not a verdict: neutral, as on the page. -->
        <span
          class="{toneClass(
            toneOf('state'),
            'chip',
          )} rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap">Enabled</span
        >
        <p class="text-text-secondary text-sm">
          Your account is protected with two-factor authentication.
        </p>
      </div>
      <div class="flex flex-col gap-3">
        <FieldBox label="Confirm your password" required />
        <div class="flex items-end gap-3">
          <FieldBox label="Authenticator code" required placeholder="000000" width={232} />
          <span class={stageButton("secondary")}>Disable 2FA</span>
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
            <span class={stageButton("secondary", "sm")}>Revoke</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
