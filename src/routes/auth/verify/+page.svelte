<script>
  import Button from "$lib/components/ui/Button.svelte";
  import { toneClass } from "$lib/utils/status-tone";

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
      <!-- The glyph is decoration: the heading below already says it. -->
      <p class="text-4xl" aria-hidden="true">&#10003;</p>
      <h1 class={[toneClass("happened", "text"), "mt-3 text-2xl font-bold"]}>Email Verified</h1>
      <p class="text-text-secondary mt-2">Your email has been verified successfully.</p>
    {:else}
      <p class="text-4xl" aria-hidden="true">&#10007;</p>
      <h1 class={[toneClass("wrong", "text"), "mt-3 text-2xl font-bold"]}>Verification Failed</h1>
      <p class="text-text-secondary mt-2">{data.error}</p>
    {/if}
    <Button variant="primary" href="/dashboard" class="mt-6">Go to Dashboard</Button>
  </div>
</div>
