<script lang="ts">
  import { enhance } from "$app/forms";
  import { page } from "$app/state";

  let { form } = $props();
  let loading = $state(false);

  function sanitize(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const cleaned = input.value.replace(/\D/g, "").slice(0, 6);
    if (cleaned !== input.value) input.value = cleaned;
  }
</script>

<svelte:head>
  <title>Two-Factor Authentication — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Two-Factor Authentication</h1>
    <p class="text-text-secondary mb-6">Enter the 6-digit code from your authenticator app.</p>

    <!-- Always describes the code field, but marks it invalid only for a 400
         (a malformed or wrong code). The same bare string also carries the
         per-account rate limit, a 429 that someone else holding the password
         can trigger against a code that is correct. -->
    {#if form?.error}
      <div
        id="form-error"
        class="bg-danger/10 text-danger-ink mb-4 rounded-lg p-3 text-sm"
        role="alert"
      >
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
          maxlength="6"
          required
          oninput={sanitize}
          aria-invalid={form?.error && page.status === 400 ? "true" : undefined}
          aria-describedby={form?.error ? "form-error" : undefined}
          class="border-border-strong bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent-ink focus:ring-accent-ink w-full rounded-lg border px-4 py-2.5 text-center text-2xl tracking-widest focus:ring-1 focus:outline-none"
          placeholder="000000"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        class="bg-accent hover:bg-accent-hover text-accent-fg w-full rounded-lg py-2.5 font-medium transition-colors disabled:opacity-50"
      >
        {loading ? "Verifying..." : "Verify"}
      </button>
    </form>

    <p class="text-text-secondary mt-6 text-center text-sm">
      <a href="/auth/login" class="text-accent-ink hover:underline">Back to login</a>
    </p>
  </div>
</div>
