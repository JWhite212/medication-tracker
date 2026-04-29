<script lang="ts">
  import { enhance } from '$app/forms';
  import appIcon from '$lib/assets/medtracker-icon-vector.svg';
  import splashImage from '$lib/assets/8ccec61e-617c-4da0-8596-c6aa9970893e.png';

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign Up — MedTracker</title>
  <meta name="description" content="Create a free MedTracker account to start tracking medications, logging doses, and monitoring adherence." />
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app/auth/register" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center gap-12 px-4 py-8">
  <div class="hidden lg:flex lg:flex-col lg:items-center lg:justify-center">
    <img
      src={splashImage}
      alt="MedTracker — Track medications with confidence"
      width="300"
      height="540"
      class="max-h-[80vh] w-auto rounded-3xl shadow-2xl shadow-accent/10"
    />
  </div>
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 backdrop-blur-xl">
    <a href="/" class="mb-4 flex items-center gap-2 text-text-secondary hover:text-text-primary">
      <img src={appIcon} alt="" width="40" height="40" class="h-10 w-10 rounded-lg" />
      <span class="text-base font-semibold">MedTracker</span>
    </a>
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
          <p class="mt-1 text-sm text-danger" role="alert">{form.errors.name[0]}</p>
        {/if}
      </div>

      <div>
        <label for="email" class="mb-1 block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required value={form?.email ?? ''}
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="you@example.com" />
        {#if form?.errors?.email}
          <p class="mt-1 text-sm text-danger" role="alert">{form.errors.email[0]}</p>
        {/if}
      </div>

      <div>
        <label for="password" class="mb-1 block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required minlength="8"
          class="w-full rounded-lg border border-glass-border bg-surface-raised px-4 py-2.5 text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Min. 8 characters" />
        {#if form?.errors?.password}
          <p class="mt-1 text-sm text-danger" role="alert">{form.errors.password[0]}</p>
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
