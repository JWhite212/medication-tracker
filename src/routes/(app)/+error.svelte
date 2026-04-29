<script>
  import { page } from "$app/stores";
</script>

<svelte:head>
  <title>{$page.status === 404 ? "Page Not Found" : "Error"} — MedTracker</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl space-y-6">
  <div
    class="border-glass-border bg-glass flex flex-col items-center rounded-xl border p-12 text-center backdrop-blur-xl"
  >
    <p class="text-accent text-5xl font-bold">{$page.status}</p>
    <h1 class="text-text-primary mt-4 text-xl font-semibold">
      {$page.status === 404 ? "Page not found" : "Something went wrong"}
    </h1>
    <p class="text-text-secondary mt-2">
      {$page.error?.message ?? "An unexpected error occurred."}
    </p>
    <a
      href="/dashboard"
      class="bg-accent text-accent-fg mt-6 rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90"
    >
      Back to dashboard
    </a>
  </div>
</div>
