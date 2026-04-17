<script lang="ts">
  import { enhance } from '$app/forms';

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign Up — MedTracker</title>
  <meta name="description" content="Create a free MedTracker account to start tracking medications, logging doses, and monitoring adherence." />
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app/auth/register" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Create account</h1>
    <p class="mb-6 text-text-secondary">Start tracking your medications</p>

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
        <label for="name" class="mb-1 block text-sm font-medium">Name</label>
        <input id="name" name="name" type="text" required value={form?.name ?? ''}
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Your name" />
        {#if form?.errors?.name}
          <p class="mt-1 text-sm text-danger">{form.errors.name[0]}</p>
        {/if}
      </div>

      <div>
        <label for="email" class="mb-1 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required value={form?.email ?? ''}
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="you@example.com" />
        {#if form?.errors?.email}
          <p class="mt-1 text-sm text-danger">{form.errors.email[0]}</p>
        {/if}
      </div>

      <div>
        <label for="password" class="mb-1 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required minlength="8"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Min. 8 characters" />
        {#if form?.errors?.password}
          <p class="mt-1 text-sm text-danger">{form.errors.password[0]}</p>
        {/if}
      </div>

      <button type="submit" disabled={loading}
        class="w-full rounded-lg bg-accent py-2.5 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50">
        {loading ? 'Creating account...' : 'Create account'}
      </button>
    </form>

    <p class="mt-6 text-center text-sm text-text-secondary">
      Already have an account? <a href="/auth/login" class="text-accent hover:underline">Sign in</a>
    </p>
  </div>
</div>
