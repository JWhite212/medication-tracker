<script lang="ts">
  import { enhance } from "$app/forms";

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Reset Password — MedTracker</title>
  <meta
    name="description"
    content="Reset your MedTracker password. Enter your email to receive a secure password reset link."
  />
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app/auth/reset-password" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Reset password</h1>
    <p class="text-text-secondary mb-6">Enter your email and we'll send you a reset link</p>

    {#if form?.success}
      <div class="bg-accent/10 text-accent rounded-lg p-4 text-sm">
        Check your email for a reset link. If an account exists for that address, you'll receive
        instructions shortly.
      </div>
      <p class="text-text-secondary mt-6 text-center text-sm">
        <a href="/auth/login" class="text-accent hover:underline">Back to sign in</a>
      </p>
    {:else}
      {#if form?.error}
        <div class="bg-danger/10 text-danger mb-4 rounded-lg p-3 text-sm">
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
            class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          class="bg-accent hover:bg-accent-hover w-full rounded-lg py-2.5 font-medium text-white transition-colors disabled:opacity-50"
        >
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <p class="text-text-secondary mt-6 text-center text-sm">
        Remember your password?
        <a href="/auth/login" class="text-accent hover:underline">Sign in</a>
      </p>
    {/if}
  </div>
</div>
