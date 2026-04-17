<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Two-Factor Authentication — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Two-Factor Authentication</h1>
    <p class="mb-6 text-text-secondary">Enter the 6-digit code from your authenticator app.</p>

    {#if form?.error}
      <div class="mb-4 rounded-lg bg-danger/10 p-3 text-sm text-danger" role="alert">
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
        <label for="code" class="mb-1 block text-sm font-medium">Verification Code</label>
        <input
          id="code"
          name="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]{6}"
          maxlength="6"
          required
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-center text-2xl tracking-widest text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="000000"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        {loading ? 'Verifying...' : 'Verify'}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-text-secondary">
      <a href="/auth/login" class="text-accent hover:underline">Back to login</a>
    </p>
  </div>
</div>
