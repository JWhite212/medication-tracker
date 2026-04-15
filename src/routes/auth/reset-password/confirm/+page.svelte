<script lang="ts">
  import { enhance } from '$app/forms';

  let { data, form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Set New Password — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Set new password</h1>
    <p class="mb-6 text-text-secondary">Choose a strong password for your account</p>

    {#if form?.error}
      <div class="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger">
        {form.error}
      </div>
    {/if}

    <form
      method="POST"
      use:enhance={() => {
        loading = true;
        return async ({ update }) => {
          loading = false;
          await update();
        };
      }}
      class="space-y-4"
    >
      <input type="hidden" name="token" value={form?.token ?? data.token} />

      <div>
        <label for="password" class="mb-1 block text-sm font-medium">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minlength="8"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Min. 8 characters"
        />
      </div>

      <div>
        <label for="confirmPassword" class="mb-1 block text-sm font-medium"
          >Confirm password</label
        >
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minlength="8"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Repeat your password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? 'Updating...' : 'Set new password'}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-text-secondary">
      <a href="/auth/login" class="text-accent hover:underline">Back to sign in</a>
    </p>
  </div>
</div>
