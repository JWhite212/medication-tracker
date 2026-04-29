<script lang="ts">
  import { enhance } from "$app/forms";

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

    {#if form?.error}
      <div class="bg-danger/10 text-danger mb-4 rounded-lg p-3 text-sm" role="alert">
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
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 text-center text-2xl tracking-widest focus:ring-1 focus:outline-none"
          placeholder="000000"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        class="bg-accent hover:bg-accent-hover w-full rounded-lg py-2.5 font-medium text-white transition-colors disabled:opacity-50"
      >
        {loading ? "Verifying..." : "Verify"}
      </button>
    </form>

    <p class="text-text-secondary mt-6 text-center text-sm">
      <a href="/auth/login" class="text-accent hover:underline">Back to login</a>
    </p>
  </div>
</div>
