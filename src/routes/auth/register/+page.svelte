<script lang="ts">
  import { enhance } from "$app/forms";
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import splashImage from "$lib/assets/8ccec61e-617c-4da0-8596-c6aa9970893e.png";
  import MedicalDisclaimer from "$lib/components/MedicalDisclaimer.svelte";

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
  <link rel="canonical" href="https://medication-tracker-jw.vercel.app/auth/register" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center gap-12 px-4 py-8">
  <div class="hidden lg:flex lg:flex-col lg:items-center lg:justify-center">
    <img
      src={splashImage}
      alt="MedTracker — Track medications with confidence"
      width="300"
      height="540"
      class="shadow-accent/10 max-h-[80vh] w-auto rounded-3xl shadow-2xl"
    />
  </div>
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <a href="/" class="text-text-secondary hover:text-text-primary mb-4 flex items-center gap-2">
      <img src={appIcon} alt="" width="40" height="40" class="h-10 w-10 rounded-lg" />
      <span class="text-base font-semibold">MedTracker</span>
    </a>
    <h1 class="mb-2 text-2xl font-bold">Create account</h1>
    <p class="text-text-secondary mb-6">Start tracking your medications</p>

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
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Your name"
        />
        {#if errors.name}
          <p class="text-danger mt-1 text-sm" role="alert">{errors.name[0]}</p>
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
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="you@example.com"
        />
        {#if errors.email}
          <p class="text-danger mt-1 text-sm" role="alert">{errors.email[0]}</p>
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
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Min. 8 characters"
        />
        {#if errors.password}
          <p class="text-danger mt-1 text-sm" role="alert">{errors.password[0]}</p>
        {/if}
      </div>

      <label class="text-text-secondary flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="disclaimerAcknowledged"
          required
          class="border-glass-border bg-surface-raised text-accent focus:ring-accent mt-0.5 h-4 w-4 rounded border focus:ring-1"
        />
        <span> I understand MedTracker is a personal tracking tool, not medical advice. </span>
      </label>

      <MedicalDisclaimer variant="compact" />

      <button
        type="submit"
        disabled={loading}
        class="bg-accent hover:bg-accent-hover w-full rounded-lg py-2.5 font-medium text-white transition-colors disabled:opacity-50"
      >
        {loading ? "Creating account..." : "Create account"}
      </button>
    </form>

    <p class="text-text-secondary mt-6 text-center text-sm">
      Already have an account? <a href="/auth/login" class="text-accent hover:underline">Sign in</a>
    </p>
  </div>
</div>
