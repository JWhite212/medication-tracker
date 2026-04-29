<script>
  import { page } from "$app/stores";
</script>

<svelte:head>
  <title>{$page.status === 404 ? "Page Not Found" : "Error"} — MedTracker</title>
</svelte:head>

<div class="bg-surface flex min-h-screen items-center justify-center px-4">
  <div class="text-center">
    <p class="text-accent text-6xl font-bold">{$page.status}</p>
    <h1 class="text-text-primary mt-4 text-xl font-semibold">
      {$page.status === 404 ? "Page not found" : "Something went wrong"}
    </h1>
    <p class="text-text-secondary mt-2">
      {$page.error?.message ?? "An unexpected error occurred."}
    </p>
    <a
      href="/dashboard"
      class="bg-accent text-accent-fg mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90"
    >
      Back to dashboard
    </a>
  </div>
</div>
