<script>
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.verified ? "Email Verified" : "Verification Failed"} — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div
    class="border-glass-border bg-glass w-full max-w-md rounded-xl border p-8 text-center backdrop-blur-xl"
  >
    {#if data.verified}
      <p class="text-4xl">&#10003;</p>
      <h1 class="text-success mt-3 text-2xl font-bold">Email Verified</h1>
      <p class="text-text-secondary mt-2">Your email has been verified successfully.</p>
    {:else}
      <p class="text-4xl">&#10007;</p>
      <h1 class="text-danger mt-3 text-2xl font-bold">Verification Failed</h1>
      <p class="text-text-secondary mt-2">{data.error}</p>
    {/if}
    <a
      href="/dashboard"
      class="bg-accent text-accent-fg mt-6 inline-block rounded-lg px-5 py-2.5 text-sm font-medium hover:opacity-90"
    >
      Go to Dashboard
    </a>
  </div>
</div>
