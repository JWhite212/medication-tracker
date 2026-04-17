<script>
  let { data } = $props();
</script>

<svelte:head>
  <title>{data.verified ? 'Email Verified' : 'Verification Failed'} — MedTracker</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="w-full max-w-md rounded-xl border border-glass-border bg-glass p-8 text-center backdrop-blur-xl">
    {#if data.verified}
      <p class="text-4xl">&#10003;</p>
      <h1 class="mt-3 text-2xl font-bold text-success">Email Verified</h1>
      <p class="mt-2 text-text-secondary">Your email has been verified successfully.</p>
    {:else}
      <p class="text-4xl">&#10007;</p>
      <h1 class="mt-3 text-2xl font-bold text-danger">Verification Failed</h1>
      <p class="mt-2 text-text-secondary">{data.error}</p>
    {/if}
    <a href="/dashboard" class="mt-6 inline-block rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg hover:opacity-90">
      Go to Dashboard
    </a>
  </div>
</div>
