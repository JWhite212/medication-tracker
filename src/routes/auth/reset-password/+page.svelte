<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Reset Password — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Reset password</h1>
    <p class="mb-6 text-text-secondary">Enter your email and we'll send you a reset link</p>

    {#if form?.success}
      <div class="rounded-lg bg-accent/10 p-4 text-sm text-accent">
        Check your email for a reset link. If an account exists for that address, you'll receive
        instructions shortly.
      </div>
      <p class="mt-6 text-center text-sm text-text-secondary">
        <a href="/auth/login" class="text-accent hover:underline">Back to sign in</a>
      </p>
    {:else}
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
        <div>
          <label for="email" class="mb-1 block text-sm font-medium">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            placeholder="you@example.com"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
      </form>

      <p class="mt-6 text-center text-sm text-text-secondary">
        Remember your password?
        <a href="/auth/login" class="text-accent hover:underline">Sign in</a>
      </p>
    {/if}
  </div>
</div>
