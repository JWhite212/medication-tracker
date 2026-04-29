<script lang="ts">
  import { enhance } from "$app/forms";

  let { data, form } = $props();
  let loading = $state(false);
</script>

<svelte:head>
  <title>Set New Password — MedTracker</title>
  <meta name="description" content="Choose a new password for your MedTracker account." />
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 backdrop-blur-xl">
    <h1 class="mb-2 text-2xl font-bold">Set new password</h1>
    <p class="text-text-secondary mb-6">Choose a strong password for your account</p>

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
      <input type="hidden" name="token" value={(form as { token?: string })?.token ?? data.token} />

      <div>
        <label for="password" class="mb-1 block text-sm font-medium">New password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minlength="8"
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Min. 8 characters"
        />
      </div>

      <div>
        <label for="confirmPassword" class="mb-1 block text-sm font-medium">Confirm password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minlength="8"
          class="border-glass-border bg-surface-raised text-text-primary placeholder:text-text-muted focus:border-accent focus:ring-accent w-full rounded-lg border px-4 py-2.5 focus:ring-1 focus:outline-none"
          placeholder="Repeat your password"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        class="bg-accent hover:bg-accent-hover w-full rounded-lg py-2.5 font-medium text-white transition-colors disabled:opacity-50"
      >
        {loading ? "Updating..." : "Set new password"}
      </button>
    </form>

    <p class="text-text-secondary mt-6 text-center text-sm">
      <a href="/auth/login" class="text-accent hover:underline">Back to sign in</a>
    </p>
  </div>
</div>
