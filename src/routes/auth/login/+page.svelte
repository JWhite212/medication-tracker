<script lang="ts">
  import { enhance } from "$app/forms";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { ariaDescribedBy } from "$lib/utils/form-errors";

  let { form, data } = $props();
  let loading = $state(false);

  // SvelteKit infers a discriminated union from each fail() return shape,
  // which makes form?.errors?.<key> fail to narrow. Treat errors as a
  // bag of optional string[] so the template can read any field.
  type FormErrors = Record<string, string[] | undefined>;
  const errors = $derived((form?.errors ?? {}) as FormErrors);
</script>

<svelte:head>
  <title>Sign In — MedTracker</title>
  <meta
    name="description"
    content="Sign in to MedTracker to log doses, view live medication timers, and track your adherence."
  />
  <link rel="canonical" href="https://medication-tracker.jamiewhite.site/auth/login" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <a href="/" class="text-text-secondary hover:text-text-primary mb-4 flex items-center gap-2">
      <img src={appIcon} alt="" width="40" height="40" class="h-10 w-10 rounded-lg" />
      <span class="text-base font-semibold">MedTracker</span>
    </a>
    <h1 class="mb-2 text-2xl font-bold">Welcome back</h1>
    <p class="text-text-secondary mb-6">Sign in to your account</p>

    <!-- Needs-you, so amber and never role="alert": it arrives with the page
         load from the OAuth redirect, and nothing here is wrong yet. -->
    {#if data.oauthError === "oauth_email_conflict"}
      <Alert tone="needs-you" title="An account with that email already exists." class="mb-4">
        Please sign in with your password, then link your OAuth provider from settings.
      </Alert>
    {:else if data.oauthError === "oauth_email_unverified"}
      <Alert
        tone="needs-you"
        title="Your social-login provider returned an unverified email address."
        class="mb-4"
      >
        Verify the email with your provider and try again.
      </Alert>
    {/if}

    {#if errors.form}
      <Alert tone="wrong" id="form-error" title={errors.form[0]} class="mb-4" />
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
          aria-invalid={errors.email ? "true" : undefined}
          aria-describedby={ariaDescribedBy(
            errors.email && "email-error",
            errors.form && "form-error",
          )}
          class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="you@example.com"
        />
        <!-- The action returns zod's field errors, but only `errors.form` was
             ever rendered, so an address the browser accepts and zod does not
             (`a@b`) was refused with no message at all. -->
        {#if errors.email}
          <p id="email-error" class="text-danger-ink mt-1 text-sm" role="alert">
            {errors.email[0]}
          </p>
        {/if}
      </div>
      <div>
        <label for="password" class="mb-1 block text-sm font-medium">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          aria-invalid={errors.password ? "true" : undefined}
          aria-describedby={ariaDescribedBy(
            errors.password && "password-error",
            errors.form && "form-error",
          )}
          class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Your password"
        />
        {#if errors.password}
          <p id="password-error" class="text-danger-ink mt-1 text-sm" role="alert">
            {errors.password[0]}
          </p>
        {/if}
      </div>
      <div class="flex items-center justify-between">
        <a href="/auth/reset-password" class="text-accent-ink text-sm hover:underline"
          >Forgot password?</a
        >
      </div>
      <Button
        variant="primary"
        type="submit"
        block
        disabled={loading}
        pending={loading}
        pendingLabel="Signing in…"
      >
        Sign in
      </Button>
    </form>

    {#if data.hasOAuth}
      <div class="mt-6 flex items-center gap-3">
        <div class="bg-glass-border h-px flex-1"></div>
        <span class="text-text-muted text-xs">OR</span>
        <div class="bg-glass-border h-px flex-1"></div>
      </div>
      <div class="mt-6 flex flex-col gap-3">
        <Button variant="secondary" href="/auth/callback/google" block>Continue with Google</Button>
        <Button variant="secondary" href="/auth/callback/github" block>Continue with GitHub</Button>
      </div>
    {/if}

    <p class="text-text-secondary mt-6 text-center text-sm">
      Don't have an account?
      <a href="/auth/register" class="text-accent-ink hover:underline">Sign up</a>
    </p>
  </div>
</div>
