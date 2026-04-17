<script>
  import { page } from '$app/stores';
</script>

<svelte:head>
  <title>{$page.status === 404 ? 'Page Not Found' : 'Error'} — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-surface px-4">
  <div class="text-center">
    <p class="text-6xl font-bold text-accent">{$page.status}</p>
    <h1 class="mt-4 text-xl font-semibold text-text-primary">
      {$page.status === 404 ? 'Page not found' : 'Something went wrong'}
    </h1>
    <p class="mt-2 text-text-secondary">{$page.error?.message ?? 'An unexpected error occurred.'}</p>
    <a href="/dashboard" class="mt-6 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90">
      Back to dashboard
    </a>
  </div>
</div>
