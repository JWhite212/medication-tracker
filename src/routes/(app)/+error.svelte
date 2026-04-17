<script>
  import { page } from '$app/stores';
</script>

<svelte:head>
  <title>{$page.status === 404 ? 'Page Not Found' : 'Error'} — MedTracker</title>
</svelte:head>

<div class="mx-auto max-w-2xl w-full space-y-6">
  <div class="flex flex-col items-center rounded-xl border border-glass-border bg-glass p-12 text-center backdrop-blur-xl">
    <p class="text-5xl font-bold text-accent">{$page.status}</p>
    <h1 class="mt-4 text-xl font-semibold text-text-primary">
      {$page.status === 404 ? 'Page not found' : 'Something went wrong'}
    </h1>
    <p class="mt-2 text-text-secondary">{$page.error?.message ?? 'An unexpected error occurred.'}</p>
    <a href="/dashboard" class="mt-6 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90">
      Back to dashboard
    </a>
  </div>
</div>
