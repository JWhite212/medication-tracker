<script lang="ts">
  import { enhance } from "$app/forms";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import heroImage from "$lib/assets/landing-hero-phone.webp";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";
  import Alert from "$lib/components/ui/Alert.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { ariaDescribedBy } from "$lib/utils/form-errors";

  let { form } = $props();
  let loading = $state(false);

  type FormErrors = Record<string, string[] | undefined>;
  const errors = $derived((form?.errors ?? {}) as FormErrors);
  const formValues = $derived((form ?? {}) as { name?: string; email?: string });
</script>

<svelte:head>
  <title>Sign Up — MedTracker</title>
  <meta
    name="description"
    content="Create a free MedTracker account to start tracking medications, logging doses, and monitoring adherence."
  />
  <link rel="canonical" href="https://medication-tracker.jamiewhite.site/auth/register" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center gap-12 px-4 py-8">
  <div class="hidden lg:flex lg:flex-col lg:items-center lg:justify-center">
    <!-- The landing hero (npm run render:hero), so a visitor from the landing
         page already has it cached. Lazy because it is hidden below lg, and a
         phone should not download an image it never shows. The height must be
         definite: with max-h and w-auto alone, this shrink-to-fit column gives
         an unloaded image a 0x0 box, and a lazy image with no box never loads. -->
    <img
      src={heroImage}
      alt="MedTracker's Today screen on a phone: Vitamin D is due, with Log now, Took it at and Skip, above three doses done today and two still to come later."
      width="320"
      height="696"
      loading="lazy"
      decoding="async"
      class="drop-shadow-accent/25 h-[min(696px,80vh)] w-auto drop-shadow-2xl"
    />
  </div>
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <a href="/" class="text-text-secondary hover:text-text-primary mb-4 flex items-center gap-2">
      <img src={appIcon} alt="" width="40" height="40" class="h-10 w-10 rounded-lg" />
      <span class="text-base font-semibold">MedTracker</span>
    </a>
    <h1 class="mb-2 text-2xl font-bold">Create account</h1>
    <p class="text-text-secondary mb-6">Start tracking your medications</p>

    <!-- The action's rate limit answers with `errors.form`, which this page
         never rendered: a throttled sign-up looked like a button that did
         nothing. -->
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
        <label for="name" class="mb-1 block text-sm font-medium">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={formValues.name ?? ""}
          aria-invalid={errors.name ? "true" : undefined}
          aria-describedby={ariaDescribedBy(
            errors.name && "name-error",
            errors.form && "form-error",
          )}
          class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Your name"
        />
        {#if errors.name}
          <p id="name-error" class="text-danger-ink mt-1 text-sm" role="alert">{errors.name[0]}</p>
        {/if}
      </div>

      <div>
        <label for="email" class="mb-1 block text-sm font-medium">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={formValues.email ?? ""}
          aria-invalid={errors.email ? "true" : undefined}
          aria-describedby={ariaDescribedBy(
            errors.email && "email-error",
            errors.form && "form-error",
          )}
          class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="you@example.com"
        />
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
          minlength="8"
          aria-invalid={errors.password ? "true" : undefined}
          aria-describedby={ariaDescribedBy(
            errors.password && "password-error",
            errors.form && "form-error",
          )}
          class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Min. 8 characters"
        />
        {#if errors.password}
          <p id="password-error" class="text-danger-ink mt-1 text-sm" role="alert">
            {errors.password[0]}
          </p>
        {/if}
      </div>

      <label class="text-text-secondary flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="disclaimerAcknowledged"
          required
          class="border-border-strong bg-surface-raised text-accent-ink focus:ring-accent-ink mt-0.5 h-4 w-4 rounded-xs border focus:ring-1"
        />
        <span> I understand MedTracker is a personal tracking tool, not medical advice. </span>
      </label>

      <MedicalDisclaimer variant="compact" />

      <Button
        variant="primary"
        type="submit"
        block
        disabled={loading}
        pending={loading}
        pendingLabel="Creating account…"
      >
        Create account
      </Button>
    </form>

    <p class="text-text-secondary mt-6 text-center text-sm">
      Already have an account? <a href="/auth/login" class="text-accent-ink hover:underline"
        >Sign in</a
      >
    </p>
  </div>
</div>
