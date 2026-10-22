<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";

  let { form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Reset Password — MedTracker</title>
  <meta
    name="description"
    content="Reset your MedTracker password. Enter your email to receive a secure password reset link."
  />
  <link rel="canonical" href="https://medication-tracker.jamiewhite.site/auth/reset-password" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Reset password</h1>
    <p class="text-text-secondary mb-6">Enter your email and we'll send you a reset link</p>

    <!-- The status region is here before the result, so the sent link is
         announced: an element that arrives already holding its text is not.
         Only the happened Alert goes inside it; the refusal below announces
         itself and must never sit in a polite region. -->
    <div role="status">
      {#if form?.success}
        <Alert tone="happened" title="Check your email for a reset link.">
          If an account exists for that address, you'll receive instructions shortly.
        </Alert>
      {/if}
    </div>

    {#if form?.success}
      <p class="text-text-secondary mt-6 text-center text-sm">
        <a href="/auth/login" class="text-accent-ink hover:underline">Back to sign in</a>
      </p>
    {:else}
      <!-- role="alert" because this form submits with use:enhance: there is no
           navigation, so without it a refusal was drawn on screen and never
           announced. The action names no field, so the email input is always
           described by this message but marked invalid only for a 400 (an
           empty address); the 429 is the rate limit, about an address that
           was fine. -->
      {#if form?.error}
        <Alert tone="wrong" id="form-error" title={form.error} class="mb-4" />
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
            aria-invalid={form?.error && page.status === 400 ? "true" : undefined}
            aria-describedby={form?.error ? "form-error" : undefined}
            class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>

        <Button
          variant="primary"
          type="submit"
          block
          disabled={loading}
          pending={loading}
          pendingLabel="Sending…"
        >
          Send reset link
        </Button>
      </form>

      <p class="text-text-secondary mt-6 text-center text-sm">
        Remember your password?
        <a href="/auth/login" class="text-accent-ink hover:underline">Sign in</a>
      </p>
    {/if}
  </div>
</div>
