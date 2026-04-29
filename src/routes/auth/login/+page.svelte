<script lang="ts">
  import { enhance } from "$app/forms";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";

  let { form, data } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Sign In — MedTracker</title>
  <meta
    name="description"
    content="Sign in to MedTracker to log doses, view live medication timers, and track your adherence."
  />
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app/auth/login" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <a href="/" class="text-text-secondary hover:text-text-primary mb-4 flex items-center gap-2">
      <img src={appIcon} alt="" width="40" height="40" class="h-10 w-10 rounded-lg" />
      <span class="text-base font-semibold">MedTracker</span>
    </a>
    <h1 class="mb-2 text-2xl font-bold">Welcome back</h1>
    <p class="text-text-secondary mb-6">Sign in to your account</p>

    {#if data.oauthError === "oauth_email_conflict"}
      <div class="bg-warning/10 text-warning mb-4 rounded-lg p-3 text-sm" role="alert">
        An account with that email already exists. Please sign in with your password, then link your
        OAuth provider from settings.
      </div>
    {/if}

    {#if form?.errors?.form}
      <div class="bg-danger/10 text-danger mb-4 rounded-lg p-3 text-sm" role="alert">
        {form.errors.form[0]}
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
          value={form?.email ?? ""}
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="you@example.com"
        />
      </div>
      <div>
        <label for="password" class="mb-1 block text-sm font-medium">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Your password"
        />
      </div>
      <div class="flex items-center justify-between">
        <a href="/auth/reset-password" class="text-accent text-sm hover:underline"
          >Forgot password?</a
        >
      </div>
      <button
        type="submit"
        disabled={loading}
        class="bg-accent hover:bg-accent-hover w-full rounded-lg py-2.5 font-medium text-white transition-colors disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>

    {#if data.hasOAuth}
      <div class="mt-6 flex items-center gap-3">
        <div class="bg-glass-border h-px flex-1"></div>
        <span class="text-text-muted text-xs">OR</span>
        <div class="bg-glass-border h-px flex-1"></div>
      </div>
      <div class="mt-6 flex flex-col gap-3">
        <a
          href="/auth/callback/google"
          class="border-glass-border hover:bg-glass-hover flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors"
          >Continue with Google</a
        >
        <a
          href="/auth/callback/github"
          class="border-glass-border hover:bg-glass-hover flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors"
          >Continue with GitHub</a
        >
      </div>
    {/if}

    <p class="text-text-secondary mt-6 text-center text-sm">
      Don't have an account?
      <a href="/auth/register" class="text-accent hover:underline">Sign up</a>
    </p>
  </div>
</div>
